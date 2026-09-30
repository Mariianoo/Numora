/**
 * lib/auth/confirm-signup.ts
 * Etapa "B2.4 — Signup server-controlled" — confirmação do e-mail do cadastro
 * (POST /api/auth/confirm), separada da rota para ser testável com portas.
 *
 * O e-mail leva para a PÁGINA /auth/confirm, que só mostra um botão; a
 * verificação (`verifyOtp` com o `token_hash`) acontece SÓ neste POST
 * explícito, para que scanners de e-mail que fazem GET não consumam o token
 * (de uso único). Depois do sucesso o usuário tem sessão e segue para
 * /auth/set-password, onde define a senha real.
 *
 * Segurança:
 * - Origin exatamente igual à origem canônica (CSRF / login-CSRF);
 * - destino do redirect FIXO (nunca parâmetro do request, sem open redirect)
 *   e montado sobre a origem canônica (nunca sobre `Host`);
 * - token inválido/expirado/reutilizado → mesma mensagem neutra, sem detalhe
 *   interno; `type` é sempre `signup`;
 * - o `token_hash` nunca é registrado, devolvido ou enviado ao Sentry.
 */
import { getCanonicalOrigin, isAllowedRequestOrigin } from '@/lib/auth/signup-config'
import { CONFIRM_TOKEN_TYPE, TOKEN_HASH_PATTERN } from '@/lib/email/signup-email'
import { captureAuthError } from '@/lib/monitoring/capture-auth-error'

export const SET_PASSWORD_PATH = '/auth/set-password'
export const CONFIRM_INVALID_PATH = '/auth/confirm?error=invalid'
export const CONFIRM_UNAVAILABLE_PATH = '/auth/confirm?error=unavailable'

export type VerifyOtpOutcome =
  | { ok: true; userId: string }
  | { ok: false; kind: 'invalid' | 'unavailable' }

export interface ConfirmDeps {
  env: Record<string, string | undefined>
  /** `verifyOtp({ token_hash, type: 'signup' })` no servidor (grava a sessão nos cookies). */
  verifyOtp: (tokenHash: string) => Promise<VerifyOtpOutcome>
  /** Efeitos pós-confirmação que nunca bloqueiam (ex.: atribuição first-touch). */
  afterConfirm?: (userId: string) => Promise<void>
  requestId?: string
}

export type ConfirmResult =
  | { kind: 'redirect'; location: string; status: 303 }
  | { kind: 'error'; status: 403 | 503; message: string }

async function readForm(request: Request): Promise<{ tokenHash: unknown; type: unknown } | null> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  try {
    if (contentType.startsWith('application/x-www-form-urlencoded') || contentType.startsWith('multipart/form-data')) {
      const form = await request.formData()
      return { tokenHash: form.get('token_hash'), type: form.get('type') }
    }
    if (contentType.startsWith('application/json')) {
      const json = (await request.json()) as Record<string, unknown>
      return { tokenHash: json?.token_hash, type: json?.type }
    }
  } catch {
    return null
  }
  return null
}

export async function handleConfirmRequest(request: Request, deps: ConfirmDeps): Promise<ConfirmResult> {
  const origin = getCanonicalOrigin(deps.env)
  if (!origin.ok) {
    captureAuthError('signup_config', new Error('Origem canônica ausente ou inválida.'), { requestId: deps.requestId })
    return { kind: 'error', status: 503, message: 'Serviço temporariamente indisponível.' }
  }

  if (!isAllowedRequestOrigin(request, origin.origin)) {
    return { kind: 'error', status: 403, message: 'Requisição não permitida.' }
  }

  const invalid: ConfirmResult = { kind: 'redirect', location: new URL(CONFIRM_INVALID_PATH, origin.origin).toString(), status: 303 }

  const form = await readForm(request)
  if (!form) return invalid

  const { tokenHash, type } = form
  if (type !== CONFIRM_TOKEN_TYPE || typeof tokenHash !== 'string' || !TOKEN_HASH_PATTERN.test(tokenHash)) return invalid

  let outcome: VerifyOtpOutcome
  try {
    outcome = await deps.verifyOtp(tokenHash)
  } catch (error) {
    captureAuthError('auth_confirm', error, { requestId: deps.requestId })
    return { kind: 'redirect', location: new URL(CONFIRM_UNAVAILABLE_PATH, origin.origin).toString(), status: 303 }
  }

  if (!outcome.ok) {
    const path = outcome.kind === 'unavailable' ? CONFIRM_UNAVAILABLE_PATH : CONFIRM_INVALID_PATH
    return { kind: 'redirect', location: new URL(path, origin.origin).toString(), status: 303 }
  }

  if (deps.afterConfirm) {
    try {
      await deps.afterConfirm(outcome.userId)
    } catch (error) {
      // Nunca bloqueia a confirmação (a atribuição é enriquecimento).
      captureAuthError('auth_confirm', error, { requestId: deps.requestId })
    }
  }

  return { kind: 'redirect', location: new URL(SET_PASSWORD_PATH, origin.origin).toString(), status: 303 }
}
