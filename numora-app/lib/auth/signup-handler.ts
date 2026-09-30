/**
 * lib/auth/signup-handler.ts
 * Etapa "B2.4 — Signup server-controlled" + "B2.4.1 — Hardening de ownership"
 * — orquestração do cadastro público NO SERVIDOR, separada da rota
 * (app/api/auth/signup/route.ts) e falando com o Supabase/Resend por PORTAS
 * injetadas (testável sem rede).
 *
 * ARQUITETURA: o GoTrue público permanece com `disable_signup=true`
 * (configuração externa). Toda conta pública nasce AQUI, pela Admin API
 * (service_role), com uma senha ALEATÓRIA descartada — o usuário define a real
 * só depois de confirmar o e-mail.
 *
 * OWNERSHIP (B2.4.1). Distinção explícita de três situações, decidida pela
 * criação ATÔMICA e por leitura do estado real em `auth.users`, nunca por
 * `profiles.email`, nunca por heurística de tempo:
 *  A) usuário criado por ESTE request — `admin.createUser` teve sucesso (o
 *     índice único do banco garante UM vencedor; o perdedor nunca é dono). A
 *     conta nasce com `app_metadata` (server-only: o usuário não a edita e o
 *     `generateLink` não a sobrescreve) contendo o marcador do fluxo, um NONCE
 *     aleatório deste request (`signup_attempt_nonce`) e `signup_state =
 *     'provisioning'`;
 *  B) usuário pendente PREEXISTENTE — `createUser` devolveu e-mail existente.
 *     Nunca é "adotado": não recebe consentimento deste request, nem
 *     marcador, nem rollback. Só recebe um link novo se for pendente do fluxo
 *     público (marcador + nonce em app_metadata) e já estiver `ready`;
 *  C) usuário confirmado — nada acontece.
 *
 * Ordem do caminho A (cada passo é fail-closed):
 *  1. flag, configuração, Origin, corpo, validação, Turnstile no servidor;
 *  2. createUser (dono do nonce) → generateLink (token; só toca user_metadata);
 *  3. PROVA de ownership: reler o usuário e conferir nonce, marcador,
 *     `provisioning` e não confirmado — ANTES de gravar consentimento ou
 *     enviar e-mail. Qualquer dúvida → nada é gravado/enviado/apagado;
 *  4. legal_consents (servidor) → e-mail (Resend) → `signup_state = 'ready'`;
 *  5. falha depois da criação → rollback OWNERSHIP-AWARE: só apaga se, relido,
 *     o usuário ainda tem o nonce DESTE request, `provisioning` e não
 *     confirmado; senão preserva a conta e registra erro seguro.
 *
 * Um pendente em `provisioning` nunca recebe reemissão de outro request
 * (evita que o rollback do dono invalide um link já entregue a outro pedido).
 *
 * Respostas nunca ecoam e-mail, senha, nonce, token ou detalhes do
 * Supabase/Turnstile/Resend; nenhum desses valores é registrado em log/Sentry.
 */
import { generateDiscardedPassword } from '@/lib/auth/random-password'
import { isSignupEnabled } from '@/lib/auth/signup-flag'
import { isAllowedRequestOrigin, resolveSignupConfig } from '@/lib/auth/signup-config'
import { generateAttemptNonce } from '@/lib/auth/signup-nonce'
import { SIGNUP_ERROR_MESSAGES, validateSignupPayload, type SignupErrorCode } from '@/lib/auth/signup-validation'
import { checkCaptchaToken } from '@/lib/captcha/captcha'
import type { TurnstileVerdict } from '@/lib/captcha/turnstile-server'
import type { EmailConfig } from '@/lib/auth/signup-config'
import { buildConfirmationUrl, buildSignupConfirmationEmail } from '@/lib/email/signup-email'
import type { OutgoingEmail } from '@/lib/email/resend'
import type { ConsentToRecord } from '@/lib/legal/signup-consents'
import { captureAuthError } from '@/lib/monitoring/capture-auth-error'

export const SIGNUP_MAX_BODY_BYTES = 10_000
/** Marcador (em `app_metadata`, server-only) das contas criadas por este fluxo. */
export const SIGNUP_FLOW_MARKER = 'public_v1'
/** Intervalo mínimo entre reemissões de link para o mesmo pendente. */
export const SIGNUP_REISSUE_COOLDOWN_MS = 60 * 1000

export type SignupState = 'provisioning' | 'ready'

export type SignupResponseCode =
  | SignupErrorCode
  | 'signup_closed'
  | 'signup_unavailable'
  | 'forbidden'
  | 'captcha_failed'

export interface AuthUserInfo {
  id: string
  confirmed: boolean
  createdAt: string | null
  confirmationSentAt: string | null
  /** `app_metadata.signup_flow === 'public_v1'` E nonce presente (prova durável de origem pública). */
  ownedByPublicFlow: boolean
  /** Nonce do request que criou a conta (`app_metadata.signup_attempt_nonce`). */
  attemptNonce: string | null
  state: SignupState | null
}

export type CreatePendingResult =
  | { ok: true; userId: string; createdAt: string | null }
  | { ok: false; reason: 'email_exists' | 'failed' }

export type GenerateLinkResult =
  | { ok: true; userId: string; tokenHash: string }
  | { ok: false; reason: 'email_exists' | 'failed' }

/** Porta do Admin API (service_role) — implementada em lib/auth/signup-adapters.ts. */
export interface SignupAdminPort {
  /** Criação ATÔMICA (não confirmada, sem e-mail do GoTrue). Só o vencedor devolve `ok`. */
  createPendingUser(input: {
    email: string
    password: string
    userMetadata: Record<string, string>
    appMetadata: Record<string, string>
  }): Promise<CreatePendingResult>
  /** Consulta AUTORITATIVA em auth.users (nunca profiles). */
  findAuthUserIdByEmail(email: string): Promise<string | null>
  getUser(userId: string): Promise<AuthUserInfo | null>
  /** `generateLink(type=signup)`: só toca `user_metadata` (e só se `data` for informado). */
  generateSignupLink(input: { email: string; password: string; data?: Record<string, string>; redirectTo: string }): Promise<GenerateLinkResult>
  /** `app_metadata.signup_state = 'ready'` (merge; preserva marcador e nonce). */
  markReady(userId: string): Promise<void>
  deleteUser(userId: string): Promise<void>
}

export interface SignupHandlerDeps {
  env: Record<string, string | undefined>
  admin: SignupAdminPort
  /** Verificação do Turnstile no servidor (a secret nunca sai daqui). */
  verifyCaptcha: (token: string, secret: string) => Promise<TurnstileVerdict>
  /** Grava os consentimentos (service_role, só no servidor); lança em falha. */
  recordConsents: (userId: string, consents: ConsentToRecord[]) => Promise<void>
  /** Envia o e-mail (Resend); lança em falha. */
  sendEmail: (email: OutgoingEmail, config: EmailConfig) => Promise<void>
  /** Relógio injetável (testes). */
  now?: () => number
  /** Gerador de senha descartada injetável (testes). */
  generatePassword?: () => string
  /** Gerador do nonce por request injetável (testes). */
  generateNonce?: () => string
  /** Id de correlação (só tag de log — nunca dado do usuário). */
  requestId?: string
}

export interface SignupHandlerResult {
  status: number
  body: { ok: true; needsEmailConfirmation: true } | { ok: false; code: SignupResponseCode; error: string }
}

const OTHER_MESSAGES: Record<Exclude<SignupResponseCode, SignupErrorCode>, string> = {
  signup_closed: 'O cadastro do Numora está fechado no momento.',
  signup_unavailable: 'O cadastro está temporariamente indisponível. Tente novamente mais tarde.',
  forbidden: 'Não foi possível processar o cadastro.',
  captcha_failed: 'Não foi possível validar a verificação de segurança. Tente novamente.',
}

function failure(status: number, code: SignupResponseCode): SignupHandlerResult {
  const error = code in SIGNUP_ERROR_MESSAGES ? SIGNUP_ERROR_MESSAGES[code as SignupErrorCode] : OTHER_MESSAGES[code as keyof typeof OTHER_MESSAGES]
  return { status, body: { ok: false, code, error } }
}

/** Resposta ÚNICA para e-mail novo, existente ou pendente (sem enumeração de contas). */
const NEUTRAL_SUCCESS: SignupHandlerResult = { status: 200, body: { ok: true, needsEmailConfirmation: true } }

async function readJsonBody(request: Request): Promise<unknown | undefined> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > SIGNUP_MAX_BODY_BYTES) return undefined

  try {
    const text = await request.text()
    if (text.length > SIGNUP_MAX_BODY_BYTES) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseTime(value: string | null | undefined): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN
}

/**
 * PROVA de ownership: o usuário relido AINDA é uma conta pendente do fluxo
 * público, em `provisioning`, e traz o nonce EXATO deste request. Nenhuma
 * outra evidência (e-mail, profile, `created_at`) conta.
 */
export function isOwnedByAttempt(user: AuthUserInfo | null, nonce: string): user is AuthUserInfo {
  return (
    user !== null &&
    !user.confirmed &&
    user.ownedByPublicFlow &&
    user.state === 'provisioning' &&
    user.attemptNonce !== null &&
    user.attemptNonce === nonce
  )
}

export async function handleSignupRequest(request: Request, deps: SignupHandlerDeps): Promise<SignupHandlerResult> {
  const meta = { requestId: deps.requestId }
  const now = deps.now ?? Date.now

  // 1 — flag fail-closed (antes de ler qualquer coisa do request)
  if (!isSignupEnabled(deps.env)) return failure(403, 'signup_closed')

  // 2 — configuração completa (origem canônica, Resend, Turnstile)
  const config = resolveSignupConfig(deps.env)
  if (!config.ok) {
    captureAuthError('signup_config', new Error('Configuração do cadastro incompleta ou inválida.'), meta)
    return failure(503, 'signup_unavailable')
  }

  // 3 — Origin (CSRF): exatamente a origem canônica
  if (!isAllowedRequestOrigin(request, config.origin)) return failure(403, 'forbidden')

  // 4 — corpo e validação
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure(400, 'invalid_body')
  const payload = await readJsonBody(request)
  if (payload === undefined) return failure(400, 'invalid_body')

  const validation = validateSignupPayload(payload)
  if (!validation.ok) return failure(400, validation.code)
  const { data } = validation

  // 5 — Turnstile no servidor (resposta neutra em qualquer falha do CAPTCHA)
  if (config.captcha === 'enabled') {
    const captcha = checkCaptchaToken((payload as Record<string, unknown>).captchaToken, deps.env)
    if (!captcha.ok || !captcha.token) return failure(400, 'captcha_failed')

    const verdict = await deps.verifyCaptcha(captcha.token, config.turnstileSecret as string)
    if (verdict === 'rejected') return failure(400, 'captcha_failed')
    if (verdict === 'unavailable') {
      captureAuthError('signup_captcha', new Error('Verificação do Turnstile indisponível.'), meta)
      return failure(503, 'signup_unavailable')
    }
  }

  const redirectTo = new URL('/auth/confirm', config.origin).toString()
  const discardedPassword = (deps.generatePassword ?? generateDiscardedPassword)()
  const nonce = (deps.generateNonce ?? generateAttemptNonce)()

  // 6 — criação ATÔMICA: só o request que a vence é dono da conta
  const created = await deps.admin.createPendingUser({
    email: data.email,
    password: discardedPassword,
    userMetadata: { name: data.name, country_code: data.countryCode },
    appMetadata: { signup_flow: SIGNUP_FLOW_MARKER, signup_attempt_nonce: nonce, signup_state: 'provisioning' },
  })

  if (!created.ok) {
    // Perdeu a corrida (o GoTrue devolve 500 sem código ao perdedor) ou a conta já existia: em ambos os
    // casos ESTE request NÃO é dono. Reconsulta a fonte autoritativa; nunca adota, nunca apaga.
    let existingId: string | null
    try {
      existingId = await deps.admin.findAuthUserIdByEmail(data.email)
    } catch (error) {
      captureAuthError('signup', error, meta)
      return failure(503, 'signup_unavailable')
    }

    if (!existingId) {
      if (created.reason === 'failed') {
        captureAuthError('signup', new Error('Falha ao criar a conta pendente.'), meta)
        return failure(503, 'signup_unavailable')
      }
      return NEUTRAL_SUCCESS
    }
    return handleExistingAccount({ deps, config, meta, now, existingId, data, redirectTo, discardedPassword })
  }

  const userId = created.userId

  /** Rollback OWNERSHIP-AWARE: relê o usuário e só apaga se o nonce, o estado e a origem forem os DESTE request. */
  async function rollbackIfOwned(): Promise<void> {
    let current: AuthUserInfo | null
    try {
      current = await deps.admin.getUser(userId)
    } catch (error) {
      captureAuthError('signup_consent', error, meta)
      return // não foi possível provar ownership: preserva a conta
    }

    if (!isOwnedByAttempt(current, nonce)) {
      captureAuthError('signup_consent', new Error('Rollback não executado: ownership do usuário não comprovado.'), meta)
      return
    }

    try {
      await deps.admin.deleteUser(userId)
    } catch (deleteError) {
      captureAuthError('signup_consent', deleteError, meta)
    }
  }

  // 7 — token de confirmação (só toca user_metadata; app_metadata/nonce ficam intactos)
  const link = await deps.admin.generateSignupLink({
    email: data.email,
    password: discardedPassword,
    data: { name: data.name, country_code: data.countryCode },
    redirectTo,
  })
  if (!link.ok || link.userId !== userId) {
    captureAuthError('signup', new Error('Falha ao gerar o link de confirmação.'), meta)
    await rollbackIfOwned()
    return failure(503, 'signup_unavailable')
  }

  // 8 — PROVA de ownership ANTES de gravar consentimento ou enviar e-mail
  let proof: AuthUserInfo | null
  try {
    proof = await deps.admin.getUser(userId)
  } catch (error) {
    captureAuthError('signup', error, meta)
    return failure(503, 'signup_unavailable') // ambiguidade: nada gravado, enviado ou apagado
  }
  if (!isOwnedByAttempt(proof, nonce)) {
    captureAuthError('signup', new Error('Ownership do usuário não comprovado; consentimento e e-mail não executados.'), meta)
    return failure(503, 'signup_unavailable')
  }

  // 9 — consentimento (servidor) ANTES do e-mail (e-mail nunca sai para cadastro revertido)
  try {
    await deps.recordConsents(userId, data.consents)
  } catch (error) {
    captureAuthError('signup_consent', error, meta)
    await rollbackIfOwned()
    return failure(503, 'signup_unavailable')
  }

  // 10 — e-mail via Resend; falhou (inclusive erro ambíguo/timeout) → rollback só se o nonce for deste request
  try {
    await deps.sendEmail(
      buildSignupConfirmationEmail({
        to: data.email,
        confirmationUrl: buildConfirmationUrl(config.origin, link.tokenHash),
        idempotencyKey: `signup-${userId}-${nonce}`,
      }),
      config.email,
    )
  } catch (error) {
    captureAuthError('signup_email', error, meta)
    await rollbackIfOwned()
    return failure(503, 'signup_unavailable')
  }

  // 11 — cadastro concluído: libera reemissões legítimas. Falha aqui NUNCA reverte (o e-mail já saiu).
  try {
    await deps.admin.markReady(userId)
  } catch (error) {
    captureAuthError('signup', error, meta)
  }

  return NEUTRAL_SUCCESS
}

interface ExistingAccountContext {
  deps: SignupHandlerDeps
  config: Extract<ReturnType<typeof resolveSignupConfig>, { ok: true }>
  meta: { requestId?: string }
  now: () => number
  existingId: string
  data: Extract<ReturnType<typeof validateSignupPayload>, { ok: true }>['data']
  redirectTo: string
  discardedPassword: string
}

/**
 * Conta JÁ EXISTENTE (situações B e C). O cliente recebe a MESMA resposta
 * neutra em todos os casos. Este caminho NUNCA: grava consentimento, aplica
 * marcador/nonce, apaga a conta ou "adota" um usuário que este request não
 * criou. Só um pendente do fluxo público (marcador + nonce em `app_metadata`),
 * `ready` e fora do cooldown recebe um link novo (o anterior fica inválido; a
 * senha original não é substituída; `user_metadata` não é tocada). Contas
 * confirmadas, pendentes de outra origem (convite/admin) e pendentes ainda em
 * `provisioning` não são tocados e não recebem e-mail deste endpoint (evita
 * usá-lo para assediar um endereço ou invalidar um link de outro request).
 */
async function handleExistingAccount(ctx: ExistingAccountContext): Promise<SignupHandlerResult> {
  const { deps, config, meta, now, existingId, data, redirectTo, discardedPassword } = ctx

  let existing: AuthUserInfo | null
  try {
    existing = await deps.admin.getUser(existingId)
  } catch (error) {
    captureAuthError('signup', error, meta)
    return failure(503, 'signup_unavailable')
  }

  if (!existing || existing.confirmed || !existing.ownedByPublicFlow || existing.state !== 'ready') return NEUTRAL_SUCCESS

  const lastSent = parseTime(existing.confirmationSentAt)
  if (Number.isFinite(lastSent) && now() - lastSent < SIGNUP_REISSUE_COOLDOWN_MS) return NEUTRAL_SUCCESS

  // Sem `data`: a reemissão não sobrescreve `user_metadata` (provado no smoke B2.4.1).
  const reissued = await deps.admin.generateSignupLink({ email: data.email, password: discardedPassword, redirectTo })

  if (!reissued.ok || reissued.userId !== existingId) {
    if (!reissued.ok && reissued.reason === 'failed') captureAuthError('signup', new Error('Falha ao reemitir o link do cadastro pendente.'), meta)
    return NEUTRAL_SUCCESS
  }

  try {
    await deps.sendEmail(
      buildSignupConfirmationEmail({
        to: data.email,
        confirmationUrl: buildConfirmationUrl(config.origin, reissued.tokenHash),
        idempotencyKey: `signup-${existingId}-${now()}`,
      }),
      config.email,
    )
  } catch (error) {
    // A conta pendente já existia antes deste pedido: nunca é removida aqui.
    captureAuthError('signup_email', error, meta)
    return failure(503, 'signup_unavailable')
  }

  return NEUTRAL_SUCCESS
}
