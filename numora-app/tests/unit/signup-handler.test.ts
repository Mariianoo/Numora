/**
 * tests/unit/signup-handler.test.ts — Etapas "B2.4" e "B2.4.1 (ownership)".
 * Orquestração do cadastro com portas simuladas: flag, configuração, Origin,
 * validação, Turnstile no servidor, criação ATÔMICA da conta pendente com
 * nonce, prova de ownership antes de consentimento/e-mail, rollback
 * ownership-aware, e-mail existente/pendente/preexistente (nunca adotado),
 * anti-enumeração e ausência de segredos em resposta/log/Sentry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

import {
  handleSignupRequest,
  isOwnedByAttempt,
  SIGNUP_MAX_BODY_BYTES,
  SIGNUP_REISSUE_COOLDOWN_MS,
  type AuthUserInfo,
  type CreatePendingResult,
  type GenerateLinkResult,
  type SignupAdminPort,
  type SignupHandlerDeps,
} from '@/lib/auth/signup-handler'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { allowAllRateLimiter } from '../support/signup-rate-limiter'

const ORIGIN = 'https://app.numora.test'
const TOKEN_HASH = 'th_secret_hash_0123456789'
const CAPTCHA_TOKEN = 'captcha-token-abcdef'
const DISCARDED_PASSWORD = 'Discarded-Password-Xyz9!'
const NONCE = 'NONCE-SECRET-OF-THIS-REQUEST'
const NEW_ID = 'new-user-1'
const BASE_ENV = {
  SIGNUP_ENABLED: 'true',
  NEXT_PUBLIC_SITE_URL: ORIGIN,
  RESEND_API_KEY: 're_test_key_do_not_leak',
  RESEND_FROM_EMAIL: 'Numora <no-reply@numora.test>',
}
const CAPTCHA_ENV = { ...BASE_ENV, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site-key-publica', TURNSTILE_SECRET_KEY: 'turnstile-secret-do-not-leak' }

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria Silva',
    email: 'maria@example.com',
    countryCode: 'BR',
    termsAccepted: true,
    privacyAccepted: true,
    age18Confirmed: true,
    marketingOptIn: false,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
    ...overrides,
  }
}

function makeRequest(payload: unknown, options: { raw?: boolean; origin?: string | null; contentType?: string | null; fetchSite?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (options.contentType !== null) headers['Content-Type'] = options.contentType ?? 'application/json'
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN
  if (options.fetchSite) headers['Sec-Fetch-Site'] = options.fetchSite
  return new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers, body: options.raw ? (payload as string) : JSON.stringify(payload) })
}

/** Conta criada por ESTE request (nonce deste request, provisioning, não confirmada). */
function ownedUser(overrides: Partial<AuthUserInfo> = {}): AuthUserInfo {
  return { id: NEW_ID, confirmed: false, createdAt: new Date().toISOString(), confirmationSentAt: null, ownedByPublicFlow: true, attemptNonce: NONCE, state: 'provisioning', ...overrides }
}

/** Conta preexistente (situações B/C). */
function existingUser(overrides: Partial<AuthUserInfo> = {}): AuthUserInfo {
  return {
    id: 'existing-1',
    confirmed: false,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    confirmationSentAt: new Date(Date.now() - 3600_000).toISOString(),
    ownedByPublicFlow: true,
    attemptNonce: 'nonce-of-the-original-request',
    state: 'ready',
    ...overrides,
  }
}

function makeDeps(options: {
  env?: Record<string, string | undefined>
  create?: CreatePendingResult
  existingId?: string | null
  existing?: AuthUserInfo | null
  /** O que `getUser(NEW_ID)` devolve (leituras de prova/rollback). Padrão: usuário deste request. */
  reread?: AuthUserInfo | null | (() => Promise<AuthUserInfo | null>)
  generate?: GenerateLinkResult
  verdict?: 'ok' | 'rejected' | 'unavailable'
  recordConsents?: SignupHandlerDeps['recordConsents']
  sendEmail?: SignupHandlerDeps['sendEmail']
  deleteUser?: (id: string) => Promise<void>
  markReady?: (id: string) => Promise<void>
  findAuthUserIdByEmail?: () => Promise<string | null>
} = {}) {
  const order: string[] = []
  const existingId = options.existingId === undefined ? 'existing-1' : options.existingId
  const admin = {
    createPendingUser: vi.fn<SignupAdminPort['createPendingUser']>(async () => {
      order.push('create')
      return options.create ?? { ok: true, userId: NEW_ID, createdAt: new Date().toISOString() }
    }),
    findAuthUserIdByEmail: vi.fn<SignupAdminPort['findAuthUserIdByEmail']>(async () => (options.findAuthUserIdByEmail ? options.findAuthUserIdByEmail() : existingId)),
    getUser: vi.fn<SignupAdminPort['getUser']>(async (id) => {
      if (id === NEW_ID) {
        order.push('reread')
        const reread = options.reread === undefined ? ownedUser() : options.reread
        return typeof reread === 'function' ? reread() : reread
      }
      return options.existing === undefined ? existingUser() : options.existing
    }),
    generateSignupLink: vi.fn<SignupAdminPort['generateSignupLink']>(async () => {
      order.push('link')
      return options.generate ?? { ok: true, userId: options.create && options.create.ok ? options.create.userId : NEW_ID, tokenHash: TOKEN_HASH }
    }),
    markReady: vi.fn<SignupAdminPort['markReady']>(async (id) => {
      order.push('ready')
      if (options.markReady) await options.markReady(id)
    }),
    deleteUser: vi.fn<SignupAdminPort['deleteUser']>(async (id) => {
      order.push('delete')
      if (options.deleteUser) await options.deleteUser(id)
    }),
  }
  const verifyCaptcha = vi.fn().mockResolvedValue(options.verdict ?? 'ok')
  const recordConsents = vi.fn<SignupHandlerDeps['recordConsents']>(async (id, c) => {
    order.push('consents')
    if (options.recordConsents) await options.recordConsents(id, c)
  })
  const sendEmail = vi.fn<SignupHandlerDeps['sendEmail']>(async (e, c) => {
    order.push('email')
    if (options.sendEmail) await options.sendEmail(e, c)
  })
  const deps: SignupHandlerDeps = {
    env: options.env ?? BASE_ENV,
    admin,
    rateLimiter: allowAllRateLimiter,
    verifyCaptcha,
    recordConsents,
    sendEmail,
    generatePassword: () => DISCARDED_PASSWORD,
    generateNonce: () => NONCE,
    requestId: 'req-test-1',
  }
  return { deps, admin, verifyCaptcha, recordConsents, sendEmail, order }
}

const NEUTRAL = { status: 200, body: { ok: true, needsEmailConfirmation: true } }

beforeEach(() => captureException.mockReset())

describe('SIGNUP_ENABLED e configuração — fail-closed', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', 'yes', ' true'])('flag %j → 403 signup_closed, sem tocar Supabase/Turnstile/Resend', async (value) => {
    const { deps, admin, verifyCaptcha, sendEmail } = makeDeps({ env: { ...BASE_ENV, SIGNUP_ENABLED: value } })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ ok: false, code: 'signup_closed' })
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    expect(admin.findAuthUserIdByEmail).not.toHaveBeenCalled()
    expect(verifyCaptcha).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('flag fechada não lê o corpo nem valida Origin (corpo inválido também responde 403)', async () => {
    const { deps } = makeDeps({ env: {} })
    expect((await handleSignupRequest(makeRequest('{não é json', { raw: true, origin: null }), deps)).status).toBe(403)
  })

  it.each([
    ['origem canônica ausente', { NEXT_PUBLIC_SITE_URL: undefined }],
    ['origem canônica inválida', { NEXT_PUBLIC_SITE_URL: 'não é url' }],
    ['Resend sem API key', { RESEND_API_KEY: undefined }],
    ['Resend sem remetente', { RESEND_FROM_EMAIL: '' }],
    ['Turnstile só com site key (sem secret)', { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' }],
    ['Turnstile só com secret (sem site key)', { TURNSTILE_SECRET_KEY: 's' }],
    ['CAPTCHA_REQUIRED=true sem Turnstile', { CAPTCHA_REQUIRED: 'true' }],
    ['Production com http', { VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }],
  ])('configuração incompleta (%s) → 503 signup_unavailable, sem criar nada', async (_label, overrides) => {
    const { deps, admin, sendEmail } = makeDeps({ env: { ...BASE_ENV, ...overrides } })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ code: 'signup_unavailable' })
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('Etapa B2.5.2: VERCEL_ENV="production" ISOLADO (sem CAPTCHA_REQUIRED, sem chaves) NÃO bloqueia mais o cadastro — a dependência implícita foi removida', async () => {
    const { deps, admin } = makeDeps({ env: { ...BASE_ENV, VERCEL_ENV: 'production' } })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(result.status).toBe(200)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(1)
  })

  it('Etapa B2.5.2: CAPTCHA_REQUIRED=true FORA de Production também bloqueia sem as chaves (a política não depende mais do ambiente)', async () => {
    const { deps, admin } = makeDeps({ env: { ...BASE_ENV, CAPTCHA_REQUIRED: 'true', VERCEL_ENV: 'development' } })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(result.status).toBe(503)
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('a origem da requisição/Host nunca substitui a origem canônica: link do e-mail usa NEXT_PUBLIC_SITE_URL', async () => {
    const { deps, sendEmail } = makeDeps()
    const request = new Request('https://evil.example/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-Host': 'evil.example' },
      body: JSON.stringify(body()),
    })
    await handleSignupRequest(request, deps)
    const sent = sendEmail.mock.calls[0][0]
    expect(sent.text).toContain(`${ORIGIN}/auth/confirm?token_hash=`)
    expect(sent.text).not.toContain('evil.example')
  })
})

describe('Origin / CSRF', () => {
  it.each([
    ['Origin de outro domínio', { origin: 'https://evil.example' }],
    ['Origin ausente', { origin: null }],
    ['Origin com porta diferente', { origin: 'https://app.numora.test:8443' }],
    ['Origin http em vez de https', { origin: 'http://app.numora.test' }],
    ['Sec-Fetch-Site cross-site', { fetchSite: 'cross-site' }],
  ])('%s → 403 forbidden, nada é criado', async (_label, options) => {
    const { deps, admin, verifyCaptcha } = makeDeps()
    const result = await handleSignupRequest(makeRequest(body(), options), deps)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'forbidden' })
    expect(verifyCaptcha).not.toHaveBeenCalled()
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('Content-Type que não é JSON → 400 invalid_body', async () => {
    const { deps, admin } = makeDeps()
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      expect((await handleSignupRequest(makeRequest(body(), { contentType }), deps)).status).toBe(400)
    }
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })
})

describe('validação obrigatória no servidor (nunca só no React)', () => {
  it.each([
    ['país ausente', { countryCode: '' }, 'country_required'],
    ['país fora do Brasil', { countryCode: 'US' }, 'country_invalid'],
    ['país minúsculo', { countryCode: 'br' }, 'country_invalid'],
    ['sem termos', { termsAccepted: false }, 'terms_required'],
    ['sem privacidade', { privacyAccepted: false }, 'privacy_required'],
    ['sem 18+', { age18Confirmed: false }, 'age_confirmation_required'],
    ['18+ como string "true"', { age18Confirmed: 'true' }, 'age_confirmation_required'],
    ['versão de termos inválida', { termsVersion: '2020-01-01' }, 'documents_outdated'],
    ['versão ausente', { privacyVersion: undefined }, 'documents_outdated'],
    ['e-mail inválido', { email: 'x' }, 'email_invalid'],
  ])('%s → 400 %s; Turnstile/Supabase/Resend NÃO são chamados', async (_label, overrides, code) => {
    const { deps, admin, verifyCaptcha, recordConsents, sendEmail } = makeDeps({ env: CAPTCHA_ENV })
    const result = await handleSignupRequest(makeRequest(body({ ...overrides, captchaToken: CAPTCHA_TOKEN })), deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code })
    expect(verifyCaptcha).not.toHaveBeenCalled()
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('marketing NÃO bloqueia o cadastro e só vira consentimento com opt-in explícito', async () => {
    const without = makeDeps()
    expect((await handleSignupRequest(makeRequest(body({ marketingOptIn: undefined })), without.deps)).status).toBe(200)
    expect(without.recordConsents.mock.calls[0][1].map((c) => c.documentType)).not.toContain('marketing_email')

    const withOptIn = makeDeps()
    await handleSignupRequest(makeRequest(body({ marketingOptIn: true })), withOptIn.deps)
    expect(withOptIn.recordConsents.mock.calls[0][1].map((c) => c.documentType)).toContain('marketing_email')
  })

  it.each([
    ['JSON inválido', '{nao-json'],
    ['vazio', ''],
    ['grande demais', JSON.stringify({ pad: 'x'.repeat(SIGNUP_MAX_BODY_BYTES + 10) })],
  ])('corpo %s → 400 invalid_body', async (_label, raw) => {
    const { deps, admin } = makeDeps()
    const result = await handleSignupRequest(makeRequest(raw, { raw: true }), deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'invalid_body' })
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })
})

describe('Turnstile — verificado NO SERVIDOR, resposta neutra', () => {
  it('Turnstile aprovado → segue o fluxo; a secret vai só à porta de verificação', async () => {
    const { deps, verifyCaptcha, admin } = makeDeps({ env: CAPTCHA_ENV })
    const result = await handleSignupRequest(makeRequest(body({ captchaToken: CAPTCHA_TOKEN })), deps)
    expect(result).toEqual(NEUTRAL)
    expect(verifyCaptcha).toHaveBeenCalledWith(CAPTCHA_TOKEN, 'turnstile-secret-do-not-leak')
    expect(admin.createPendingUser).toHaveBeenCalledTimes(1)
  })

  it('Turnstile rejeitado → 400 captcha_failed (neutro) e NADA é criado', async () => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({ env: CAPTCHA_ENV, verdict: 'rejected' })
    const result = await handleSignupRequest(makeRequest(body({ captchaToken: CAPTCHA_TOKEN })), deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'captcha_failed' })
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    expect(admin.findAuthUserIdByEmail).not.toHaveBeenCalled()
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['não string', 12345],
    ['com espaços', 'abc def'],
    ['grande demais', 'a'.repeat(2049)],
  ])('token %s → MESMA resposta neutra captcha_failed, sem chamar o Turnstile', async (_label, token) => {
    const { deps, verifyCaptcha, admin } = makeDeps({ env: CAPTCHA_ENV })
    const result = await handleSignupRequest(makeRequest(body({ captchaToken: token })), deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'captcha_failed' })
    expect(verifyCaptcha).not.toHaveBeenCalled()
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('a resposta é idêntica para token ausente e rejeitado (não revela o motivo)', async () => {
    const missing = await handleSignupRequest(makeRequest(body()), makeDeps({ env: CAPTCHA_ENV }).deps)
    const rejected = await handleSignupRequest(makeRequest(body({ captchaToken: CAPTCHA_TOKEN })), makeDeps({ env: CAPTCHA_ENV, verdict: 'rejected' }).deps)
    expect(missing).toEqual(rejected)
  })

  it('Turnstile indisponível → 503 fail-closed (nunca deixa passar) e Sentry sem token/secret', async () => {
    const { deps, admin } = makeDeps({ env: CAPTCHA_ENV, verdict: 'unavailable' })
    const result = await handleSignupRequest(makeRequest(body({ captchaToken: CAPTCHA_TOKEN })), deps)
    expect(result.status).toBe(503)
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    const sentry = JSON.stringify(captureException.mock.calls)
    expect(sentry).not.toContain(CAPTCHA_TOKEN)
    expect(sentry).not.toContain('turnstile-secret-do-not-leak')
  })

  it('CAPTCHA desligado (não Production): não exige token e não chama o Turnstile', async () => {
    const { deps, verifyCaptcha } = makeDeps()
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(200)
    expect(verifyCaptcha).not.toHaveBeenCalled()
  })
})

describe('caminho A — conta criada por ESTE request (criação atômica, nonce, prova de ownership)', () => {
  it('cria pela via ATÔMICA com senha aleatória do servidor, metadata mínima e marcador/nonce em app_metadata (nunca user_metadata)', async () => {
    const { deps, admin } = makeDeps()
    await handleSignupRequest(makeRequest(body()), deps)

    expect(admin.createPendingUser).toHaveBeenCalledTimes(1)
    const input = admin.createPendingUser.mock.calls[0][0]
    expect(input.email).toBe('maria@example.com')
    expect(input.password).toBe(DISCARDED_PASSWORD)
    expect(input.userMetadata).toEqual({ name: 'Maria Silva', country_code: 'BR' })
    expect(input.appMetadata).toEqual({ signup_flow: 'public_v1', signup_attempt_nonce: NONCE, signup_state: 'provisioning' })
    expect(JSON.stringify(input.userMetadata)).not.toMatch(/signup_flow|nonce|public_v1/)
  })

  it('o nonce é gerado no servidor a cada request (distinto entre requests) e nunca vem do cliente', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const { deps, admin } = makeDeps()
      delete deps.generateNonce
      await handleSignupRequest(makeRequest(body({ signup_attempt_nonce: 'do-cliente', signup_flow: 'public_v1' })), deps)
      const nonce = admin.createPendingUser.mock.calls[0][0].appMetadata.signup_attempt_nonce
      expect(nonce).not.toBe('do-cliente')
      expect(nonce.length).toBeGreaterThanOrEqual(32)
      seen.add(nonce)
    }
    expect(seen.size).toBe(20)
  })

  it('a ORDEM é: criar → gerar link → reler (prova) → consentimentos → e-mail → ready; profiles nunca é consultado', async () => {
    const { deps, order, admin } = makeDeps()
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(order).toEqual(['create', 'link', 'reread', 'consents', 'email', 'ready'])
    expect('findProfileIdByEmail' in admin).toBe(false)
  })

  it('o link (generateLink) só leva user_metadata (nome/país) — app_metadata/nonce nunca passam por ele — e o redirect é canônico', async () => {
    const { deps, admin } = makeDeps()
    await handleSignupRequest(makeRequest(body()), deps)
    const link = admin.generateSignupLink.mock.calls[0][0]
    expect(link.data).toEqual({ name: 'Maria Silva', country_code: 'BR' })
    expect(link.redirectTo).toBe(`${ORIGIN}/auth/confirm`)
    expect(link.password).toBe(DISCARDED_PASSWORD)
  })

  it('grava legal_consents pelo SERVIDOR com as versões vigentes, para o id que este request criou', async () => {
    const { deps, recordConsents } = makeDeps()
    await handleSignupRequest(makeRequest(body()), deps)
    expect(recordConsents).toHaveBeenCalledWith(NEW_ID, [
      { documentType: 'terms', documentVersion: TERMS_VERSION },
      { documentType: 'privacy', documentVersion: PRIVACY_VERSION },
      { documentType: 'age_18', documentVersion: AGE_CONFIRMATION_VERSION },
    ])
  })

  it('campos forjados no payload (metadata, versões, nonce, marcador) NUNCA chegam ao GoTrue nem viram consentimento', async () => {
    const { deps, admin, recordConsents } = makeDeps()
    await handleSignupRequest(
      makeRequest(body({ user_metadata: { terms_accepted: 'forjada' }, app_metadata: { signup_flow: 'forjada' }, terms_accepted: 'forjada', age18: 'forjada', data: { x: 'forjada' } })),
      deps,
    )
    expect(JSON.stringify(admin.createPendingUser.mock.calls)).not.toContain('forjada')
    expect(JSON.stringify(admin.generateSignupLink.mock.calls)).not.toContain('forjada')
    expect(JSON.stringify(recordConsents.mock.calls)).not.toContain('forjada')
  })

  it('a senha do cliente nunca é usada', async () => {
    const { deps, admin } = makeDeps()
    await handleSignupRequest(makeRequest(body({ password: 'SenhaDoCliente@1' })), deps)
    expect(JSON.stringify(admin.createPendingUser.mock.calls)).not.toContain('SenhaDoCliente')
  })

  it('e-mail de confirmação: link canônico com token_hash e type=signup, chave de idempotência por tentativa, sem nome digitado', async () => {
    const { deps, sendEmail } = makeDeps()
    await handleSignupRequest(makeRequest(body({ name: 'Nome <script>alert(1)</script>' })), deps)
    const [email, config] = sendEmail.mock.calls[0]
    expect(email.to).toBe('maria@example.com')
    expect(email.text).toContain(`${ORIGIN}/auth/confirm?token_hash=${TOKEN_HASH}&type=signup`)
    expect(email.html).not.toContain('<script>')
    expect(email.text + email.html).not.toContain('Nome')
    expect(email.idempotencyKey).toBe(`signup-${NEW_ID}-${NONCE}`)
    expect(config).toEqual({ apiKey: 're_test_key_do_not_leak', from: 'Numora <no-reply@numora.test>' })
  })

  it('a resposta é neutra e nunca contém senha, nonce, token, e-mail, link nem chaves', async () => {
    const { deps } = makeDeps({ env: CAPTCHA_ENV })
    const result = await handleSignupRequest(makeRequest(body({ captchaToken: CAPTCHA_TOKEN })), deps)
    const json = JSON.stringify(result)
    expect(result).toEqual(NEUTRAL)
    for (const secret of [DISCARDED_PASSWORD, NONCE, TOKEN_HASH, 'maria@example.com', 're_test_key_do_not_leak', 'turnstile-secret-do-not-leak', CAPTCHA_TOKEN, 'auth/confirm']) {
      expect(json).not.toContain(secret)
    }
  })

  it('markReady falhando NÃO reverte (o e-mail já saiu): resposta neutra, nada apagado, erro no Sentry', async () => {
    const { deps, admin } = makeDeps({
      markReady: async () => {
        throw new Error('falha')
      },
    })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(captureException).toHaveBeenCalledTimes(1)
  })
})

describe('isOwnedByAttempt — a ÚNICA prova aceita de ownership', () => {
  it('só o usuário pendente, do fluxo, provisioning e com o MESMO nonce', () => {
    expect(isOwnedByAttempt(ownedUser(), NONCE)).toBe(true)
  })

  it.each([
    ['nonce diferente', ownedUser({ attemptNonce: 'outro' }), NONCE],
    ['sem nonce', ownedUser({ attemptNonce: null }), NONCE],
    ['nonce vazio comparado a vazio', ownedUser({ attemptNonce: null }), ''],
    ['confirmado', ownedUser({ confirmed: true }), NONCE],
    ['sem marcador do fluxo', ownedUser({ ownedByPublicFlow: false }), NONCE],
    ['estado ready', ownedUser({ state: 'ready' }), NONCE],
    ['estado desconhecido', ownedUser({ state: null }), NONCE],
    ['usuário inexistente', null, NONCE],
  ])('%s → NÃO é dono', (_label, user, nonce) => {
    expect(isOwnedByAttempt(user, nonce)).toBe(false)
  })

  it('created_at, e-mail e profile NÃO participam da prova (um usuário recente sem o nonce continua não sendo dono)', () => {
    expect(isOwnedByAttempt(ownedUser({ attemptNonce: 'de-outro-request', createdAt: new Date().toISOString() }), NONCE)).toBe(false)
  })
})

describe('prova de ownership ANTES de consentimento e e-mail (ambiguidade ⇒ nada é gravado, enviado ou apagado)', () => {
  it.each([
    ['nonce diferente após o link (outro request assumiu a conta)', ownedUser({ attemptNonce: 'de-outro-request' })],
    ['conta sem nonce', ownedUser({ attemptNonce: null })],
    ['conta já confirmada', ownedUser({ confirmed: true })],
    ['conta sem o marcador do fluxo', ownedUser({ ownedByPublicFlow: false })],
    ['estado diferente de provisioning', ownedUser({ state: 'ready' })],
    ['usuário desapareceu', null],
  ])('%s → 503 sem consentimento, sem e-mail e SEM deleteUser', async (_label, reread) => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({ reread })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(result.status).toBe(503)
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('a releitura falhar (erro do Admin API) → 503 sem consentimento, e-mail nem delete', async () => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({
      reread: async () => {
        throw new Error('admin api fora do ar')
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('o link devolver OUTRO usuário → nada gravado/enviado; rollback só se o nonce do usuário criado for o deste request', async () => {
    const owned = makeDeps({ generate: { ok: true, userId: 'someone-else', tokenHash: TOKEN_HASH } })
    expect((await handleSignupRequest(makeRequest(body()), owned.deps)).status).toBe(503)
    expect(owned.recordConsents).not.toHaveBeenCalled()
    expect(owned.sendEmail).not.toHaveBeenCalled()
    expect(owned.admin.deleteUser).toHaveBeenCalledWith(NEW_ID) // é dono (nonce confere)

    const notOwned = makeDeps({ generate: { ok: true, userId: 'someone-else', tokenHash: TOKEN_HASH }, reread: ownedUser({ attemptNonce: 'de-outro' }) })
    await handleSignupRequest(makeRequest(body()), notOwned.deps)
    expect(notOwned.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('generateLink falha → nada gravado/enviado; a conta deste request (provada por nonce) é removida', async () => {
    const { deps, recordConsents, sendEmail, admin } = makeDeps({ generate: { ok: false, reason: 'failed' } })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(admin.deleteUser).toHaveBeenCalledWith(NEW_ID)
  })
})

describe('rollback OWNERSHIP-AWARE — nunca apaga conta que este request não provou ser sua', () => {
  it('consentimento falha → relê, confere o nonce e remove a conta; e-mail NUNCA enviado; 503', async () => {
    const { deps, sendEmail, admin, order } = makeDeps({
      recordConsents: async () => {
        throw new Error('db down for maria@example.com')
      },
    })
    const result = await handleSignupRequest(makeRequest(body()), deps)

    expect(result.status).toBe(503)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(admin.deleteUser).toHaveBeenCalledTimes(1)
    expect(admin.deleteUser).toHaveBeenCalledWith(NEW_ID)
    // releitura para provar ownership imediatamente ANTES do delete
    expect(order.slice(order.indexOf('consents'))).toEqual(['consents', 'reread', 'delete'])
    expect(JSON.stringify(captureException.mock.calls)).not.toContain('maria@example.com')
    expect(captureException.mock.calls[0][1].tags.auth_context).toBe('signup_consent')
  })

  it('Resend falha ANTES de enviar (erro do provedor) → conta deste request removida', async () => {
    const { deps, admin } = makeDeps({
      sendEmail: async () => {
        throw Object.assign(new Error('resend: 422'), { status: 422 })
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(admin.deleteUser).toHaveBeenCalledWith(NEW_ID)
    expect(captureException.mock.calls[0][1].tags.auth_context).toBe('signup_email')
  })

  it('Resend com timeout/erro AMBÍGUO → rollback SOMENTE porque o nonce é deste request', async () => {
    const { deps, admin } = makeDeps({
      sendEmail: async () => {
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' })
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(admin.deleteUser).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['nonce de OUTRO request (conta compartilhada)', ownedUser({ attemptNonce: 'nonce-de-outro-request' })],
    ['conta confirmada entretanto', ownedUser({ confirmed: true })],
    ['conta já em ready', ownedUser({ state: 'ready' })],
    ['marcador do fluxo ausente', ownedUser({ ownedByPublicFlow: false })],
    ['conta já removida', null],
  ])('falha do Resend com ownership NÃO comprovado (%s) → conta PRESERVADA, erro seguro no Sentry', async (_label, afterProof) => {
    let reads = 0
    const { deps, admin } = makeDeps({
      reread: async () => {
        reads += 1
        return reads === 1 ? ownedUser() : afterProof // 1ª leitura = prova; 2ª = releitura do rollback
      },
      sendEmail: async () => {
        throw new Error('resend down')
      },
    })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(result.status).toBe(503)
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(captureException.mock.calls.some((call) => call[1].tags.auth_context === 'signup_consent')).toBe(true)
  })

  it('não conseguir reler o usuário no rollback → conta PRESERVADA', async () => {
    let reads = 0
    const { deps, admin } = makeDeps({
      reread: async () => {
        reads += 1
        if (reads === 1) return ownedUser()
        throw new Error('admin api fora do ar')
      },
      sendEmail: async () => {
        throw new Error('resend down')
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('deleteUser falhar → ainda 503 (fail-closed), sem exceção, erro no Sentry', async () => {
    const { deps } = makeDeps({
      sendEmail: async () => {
        throw new Error('resend down')
      },
      deleteUser: async () => {
        throw new Error('falha ao apagar')
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(captureException.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('o rollback usa SÓ o nonce: um usuário recente (created_at) e com o mesmo e-mail, mas nonce diferente, nunca é apagado', async () => {
    let reads = 0
    const { deps, admin } = makeDeps({
      reread: async () => {
        reads += 1
        return reads === 1 ? ownedUser() : ownedUser({ attemptNonce: 'outro', createdAt: new Date().toISOString() })
      },
      sendEmail: async () => {
        throw new Error('resend down')
      },
    })
    await handleSignupRequest(makeRequest(body()), deps)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('erros do Supabase/Resend/Turnstile nunca chegam ao cliente', async () => {
    const { deps } = makeDeps({
      sendEmail: async () => {
        throw Object.assign(new Error('resend: invalid api key re_test_key_do_not_leak'), { status: 401 })
      },
    })
    const result = await handleSignupRequest(makeRequest(body()), deps)
    expect(JSON.stringify(result)).not.toMatch(/resend|api key|re_test|nonce/i)
  })
})

describe('caminho B/C — conta JÁ EXISTENTE: nunca adotada, sem consentimento, sem marcador, sem e-mail indevido, sem rollback', () => {
  it('e-mail CONFIRMADO → resposta neutra; nada é gerado, gravado, enviado ou removido', async () => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ confirmed: true }) })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(admin.generateSignupLink).not.toHaveBeenCalled()
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(admin.markReady).not.toHaveBeenCalled()
  })

  it('TESTE 2 — pendente PREEXISTENTE criado por outra origem (Admin API/convite, sem app_metadata do fluxo): não é adotado', async () => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({
      create: { ok: false, reason: 'email_exists' },
      existing: existingUser({ ownedByPublicFlow: false, attemptNonce: null, state: null }),
    })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(recordConsents).not.toHaveBeenCalled() // sem legal_consents
    expect(sendEmail).not.toHaveBeenCalled() // sem e-mail
    expect(admin.generateSignupLink).not.toHaveBeenCalled() // não toca a conta (nem o marcador em user_metadata)
    expect(admin.markReady).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(admin.createPendingUser).toHaveBeenCalledTimes(1) // única escrita tentada foi a criação atômica, que falhou
  })

  it('a "adoção" não ocorre nem quando profiles.email diverge: a decisão vem de auth.users (lookup autoritativo), profiles nunca é consultado', async () => {
    const { deps, admin, recordConsents } = makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ ownedByPublicFlow: false, attemptNonce: null, state: null }) })
    await handleSignupRequest(makeRequest(body()), deps)
    expect(admin.findAuthUserIdByEmail).toHaveBeenCalledWith('maria@example.com')
    expect(recordConsents).not.toHaveBeenCalled()
  })

  it('pendente do fluxo ainda em PROVISIONING (outro request em andamento) → neutro, sem reemissão (não invalida link nem compete com o rollback do dono)', async () => {
    const { deps, admin, sendEmail } = makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ state: 'provisioning' }) })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(admin.generateSignupLink).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('TESTE 5 — reemissão LEGÍTIMA (pendente do fluxo, ready, fora do cooldown): novo link, SEM consentimento novo, sem trocar dono/nonce/senha, sem remover', async () => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({
      create: { ok: false, reason: 'email_exists' },
      existing: existingUser(),
      generate: { ok: true, userId: 'existing-1', tokenHash: 'th_reissued_0123456789' },
    })
    expect(await handleSignupRequest(makeRequest(body({ name: 'Outro Nome', marketingOptIn: true })), deps)).toEqual(NEUTRAL)

    const input = admin.generateSignupLink.mock.calls[0][0]
    expect(input.data).toBeUndefined() // não sobrescreve user_metadata (nem o nome)
    expect(input.password).toBe(DISCARDED_PASSWORD) // aleatória do servidor; a senha original NÃO é substituída (B2.3)
    expect(JSON.stringify(input)).not.toContain('Outro Nome')
    expect(recordConsents).not.toHaveBeenCalled() // consentimento não é duplicado nem escrito em nome da conta
    expect(sendEmail.mock.calls[0][0].text).toContain('token_hash=th_reissued_0123456789')
    expect(admin.createPendingUser).toHaveBeenCalledTimes(1) // sem novo nonce/dono
    expect(admin.markReady).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('cooldown: pendente com link emitido há menos de 60s não recebe outro e-mail', async () => {
    const recent = new Date(Date.now() - SIGNUP_REISSUE_COOLDOWN_MS / 2).toISOString()
    const { deps, admin, sendEmail } = makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ confirmationSentAt: recent }) })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(admin.generateSignupLink).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reemissão devolvendo OUTRO usuário → neutro, sem enviar', async () => {
    const { deps, sendEmail, recordConsents } = makeDeps({
      create: { ok: false, reason: 'email_exists' },
      existing: existingUser(),
      generate: { ok: true, userId: 'someone-else', tokenHash: TOKEN_HASH },
    })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordConsents).not.toHaveBeenCalled()
  })

  it('falha do Resend na reemissão → 503, mas a conta pendente PRÉ-EXISTENTE NUNCA é removida', async () => {
    const { deps, admin } = makeDeps({
      create: { ok: false, reason: 'email_exists' },
      existing: existingUser(),
      generate: { ok: true, userId: 'existing-1', tokenHash: TOKEN_HASH },
      sendEmail: async () => {
        throw new Error('resend down')
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('PERDEDOR da corrida (createUser falha sem código, 500): reconsulta auth.users, NÃO é dono, resposta neutra, nada gravado/enviado/apagado', async () => {
    const { deps, admin, recordConsents, sendEmail } = makeDeps({ create: { ok: false, reason: 'failed' }, existing: existingUser({ state: 'provisioning' }) })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(admin.findAuthUserIdByEmail).toHaveBeenCalledTimes(1)
    expect(recordConsents).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('createUser falhou de verdade (nenhum usuário existe depois) → 503 e Sentry', async () => {
    const { deps, sendEmail } = makeDeps({ create: { ok: false, reason: 'failed' }, existingId: null })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('email_exists mas o lookup não acha o usuário (ex.: conta SSO) → neutro, nada acontece', async () => {
    const { deps, admin, sendEmail } = makeDeps({ create: { ok: false, reason: 'email_exists' }, existingId: null })
    expect(await handleSignupRequest(makeRequest(body()), deps)).toEqual(NEUTRAL)
    expect(admin.generateSignupLink).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('o lookup falhar → 503 sem tocar nada', async () => {
    const { deps, admin } = makeDeps({
      create: { ok: false, reason: 'email_exists' },
      findAuthUserIdByEmail: async () => {
        throw new Error('rpc fora do ar')
      },
    })
    expect((await handleSignupRequest(makeRequest(body()), deps)).status).toBe(503)
    expect(admin.generateSignupLink).not.toHaveBeenCalled()
  })

  it('a resposta é IDÊNTICA para e-mail novo, confirmado, preexistente de outra origem, em provisioning e perdedor da corrida', async () => {
    const results = await Promise.all([
      handleSignupRequest(makeRequest(body()), makeDeps().deps),
      handleSignupRequest(makeRequest(body()), makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ confirmed: true }) }).deps),
      handleSignupRequest(makeRequest(body()), makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ ownedByPublicFlow: false, state: null }) }).deps),
      handleSignupRequest(makeRequest(body()), makeDeps({ create: { ok: false, reason: 'email_exists' }, existing: existingUser({ state: 'provisioning' }) }).deps),
      handleSignupRequest(makeRequest(body()), makeDeps({ create: { ok: false, reason: 'failed' }, existing: existingUser({ state: 'provisioning' }) }).deps),
      handleSignupRequest(makeRequest(body()), makeDeps({ create: { ok: false, reason: 'email_exists' }, existingId: null }).deps),
    ])
    for (const result of results) expect(result).toEqual(NEUTRAL)
  })
})

describe('senha, nonce e token nunca em logs, Sentry ou console', () => {
  it('nenhum console.* é chamado e nenhum segredo chega ao Sentry, mesmo em falhas', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))

    const scenarios = [
      makeDeps(),
      makeDeps({ recordConsents: async () => { throw new Error('falha do banco') } }),
      makeDeps({ sendEmail: async () => { throw new Error('resend down') } }),
      makeDeps({ reread: ownedUser({ attemptNonce: 'outro' }) }),
      makeDeps({ env: CAPTCHA_ENV, verdict: 'unavailable' }),
      makeDeps({ env: { ...BASE_ENV, RESEND_API_KEY: undefined } }),
      makeDeps({ create: { ok: false, reason: 'failed' }, existingId: null }),
    ]
    for (const scenario of scenarios) {
      await handleSignupRequest(makeRequest(body({ captchaToken: CAPTCHA_TOKEN })), scenario.deps)
    }

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    const sentry = JSON.stringify(captureException.mock.calls)
    for (const secret of [DISCARDED_PASSWORD, NONCE, TOKEN_HASH, CAPTCHA_TOKEN, 're_test_key_do_not_leak', 'turnstile-secret-do-not-leak']) {
      expect(sentry).not.toContain(secret)
    }
    expect(captureException).toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('o id de correlação vai como tag do Sentry', async () => {
    const { deps } = makeDeps({ recordConsents: async () => { throw new Error('x') } })
    await handleSignupRequest(makeRequest(body()), deps)
    expect(captureException.mock.calls[0][1].tags.request_id).toBe('req-test-1')
  })
})
