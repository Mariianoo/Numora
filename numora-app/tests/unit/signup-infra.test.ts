/**
 * tests/unit/signup-infra.test.ts — Etapa "B2.4 — Signup server-controlled".
 * Peças de infraestrutura do cadastro: configuração/origem canônica, Turnstile
 * server-side, Resend, e-mail de confirmação, senha aleatória descartada e o
 * adaptador da Admin API (com client simulado).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createSignupAdminPort, readOwnership } from '@/lib/auth/signup-adapters'
import { getCanonicalOrigin, getEmailConfig, isAllowedRequestOrigin, resolveSignupConfig } from '@/lib/auth/signup-config'
import { generateDiscardedPassword } from '@/lib/auth/random-password'
import { checkTurnstileServerConfig, isCaptchaRequirementMet } from '@/lib/captcha/captcha'
import { verifyTurnstileToken } from '@/lib/captcha/turnstile-server'
import { EmailSendError, sendEmail } from '@/lib/email/resend'
import { TOKEN_HASH_PATTERN, buildConfirmationUrl, buildSignupConfirmationEmail } from '@/lib/email/signup-email'
import { validatePassword } from '@/lib/validation/password-policy'

const ORIGIN = 'https://www.numoracollect.com'

describe('origem canônica (NEXT_PUBLIC_SITE_URL)', () => {
  it('https válido → origem sem path/query/hash', () => {
    expect(getCanonicalOrigin({ NEXT_PUBLIC_SITE_URL: 'https://www.numoracollect.com/qualquer?x=1#y' })).toEqual({ ok: true, origin: ORIGIN })
  })

  it.each([undefined, '', '   ', 'não é url', 'ftp://numora.test', 'javascript:alert(1)', '//numora.test'])('ausente/inválida (%j) → falha segura', (value) => {
    expect(getCanonicalOrigin({ NEXT_PUBLIC_SITE_URL: value })).toEqual({ ok: false })
  })

  it('http só em localhost e fora de Production', () => {
    expect(getCanonicalOrigin({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toEqual({ ok: true, origin: 'http://localhost:3000' })
    expect(getCanonicalOrigin({ NEXT_PUBLIC_SITE_URL: 'http://numora.test' })).toEqual({ ok: false })
    expect(getCanonicalOrigin({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000', VERCEL_ENV: 'production' })).toEqual({ ok: false })
  })

  it('a origem nunca vem de Host/headers/request.url — só do env (o módulo não lê request para isso)', () => {
    const root = path.resolve(__dirname, '../..')
    const strip = (file: string) =>
      readFileSync(path.join(root, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
    for (const file of ['lib/auth/signup-config.ts', 'lib/auth/signup-handler.ts', 'lib/auth/confirm-signup.ts', 'app/api/auth/signup/route.ts', 'app/api/auth/confirm/route.ts']) {
      const code = strip(file)
      expect(code, file).not.toMatch(/headers\.get\(['"](x-forwarded-host|host|x-forwarded-proto)['"]\)/i)
      expect(code, file).not.toMatch(/new URL\(request\.url\)/)
    }
    expect(strip('lib/auth/signup-config.ts')).toMatch(/env\.NEXT_PUBLIC_SITE_URL/)
  })
})

describe('isAllowedRequestOrigin (CSRF)', () => {
  const req = (headers: Record<string, string>) => new Request('https://x.test/api', { method: 'POST', headers })

  it('aceita só o Origin exatamente igual', () => {
    expect(isAllowedRequestOrigin(req({ Origin: ORIGIN }), ORIGIN)).toBe(true)
  })

  it.each([
    [{}],
    [{ Origin: 'https://evil.example' }],
    [{ Origin: `${ORIGIN}/` }],
    [{ Origin: 'null' }],
    [{ Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }],
  ])('recusa %j', (headers) => {
    expect(isAllowedRequestOrigin(req(headers as Record<string, string>), ORIGIN)).toBe(false)
  })

  it('same-origin e same-site com Origin correto passam', () => {
    expect(isAllowedRequestOrigin(req({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' }), ORIGIN)).toBe(true)
  })
})

describe('configuração do Turnstile no servidor', () => {
  it('sem chaves → disabled; com as duas → enabled; só uma → misconfigured', () => {
    expect(checkTurnstileServerConfig({})).toEqual({ state: 'disabled' })
    expect(checkTurnstileServerConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a', TURNSTILE_SECRET_KEY: 'b' })).toEqual({ state: 'enabled', siteKey: 'a', secret: 'b' })
    expect(checkTurnstileServerConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a' })).toEqual({ state: 'misconfigured' })
    expect(checkTurnstileServerConfig({ TURNSTILE_SECRET_KEY: 'b' })).toEqual({ state: 'misconfigured' })
    expect(checkTurnstileServerConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' ', TURNSTILE_SECRET_KEY: ' ' })).toEqual({ state: 'disabled' })
  })

  it('Production exige CAPTCHA completo; fora dela só recusa configuração quebrada', () => {
    expect(isCaptchaRequirementMet({ VERCEL_ENV: 'production' })).toBe(false)
    expect(isCaptchaRequirementMet({ VERCEL_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a' })).toBe(false)
    expect(isCaptchaRequirementMet({ VERCEL_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a', TURNSTILE_SECRET_KEY: 'b' })).toBe(true)
    expect(isCaptchaRequirementMet({})).toBe(true)
    expect(isCaptchaRequirementMet({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a' })).toBe(false)
  })
})

describe('resolveSignupConfig', () => {
  const env = { NEXT_PUBLIC_SITE_URL: ORIGIN, RESEND_API_KEY: 're_k', RESEND_FROM_EMAIL: 'Numora <a@numoracollect.com>' }

  it('completo (sem CAPTCHA, não Production) → ok e captcha disabled', () => {
    expect(resolveSignupConfig(env)).toMatchObject({ ok: true, origin: ORIGIN, captcha: 'disabled', turnstileSecret: null })
  })

  it('completo com Turnstile → ok e a secret disponível SÓ no resultado do servidor', () => {
    const result = resolveSignupConfig({ ...env, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a', TURNSTILE_SECRET_KEY: 'segredo' })
    expect(result).toMatchObject({ ok: true, captcha: 'enabled', turnstileSecret: 'segredo' })
  })

  it.each([
    ['sem origem', { NEXT_PUBLIC_SITE_URL: undefined }],
    ['sem Resend key', { RESEND_API_KEY: undefined }],
    ['sem remetente', { RESEND_FROM_EMAIL: undefined }],
    ['Production sem Turnstile', { VERCEL_ENV: 'production' }],
    ['Turnstile pela metade', { TURNSTILE_SECRET_KEY: 'x' }],
  ])('%s → falha segura', (_label, overrides) => {
    expect(resolveSignupConfig({ ...env, ...overrides })).toEqual({ ok: false })
  })

  it('getEmailConfig exige chave E remetente', () => {
    expect(getEmailConfig({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'f' })).toEqual({ apiKey: 'k', from: 'f' })
    expect(getEmailConfig({ RESEND_API_KEY: 'k' })).toBeNull()
    expect(getEmailConfig({})).toBeNull()
  })
})

describe('verifyTurnstileToken (siteverify no servidor)', () => {
  const ok = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))

  it('success=true → ok, com secret e token enviados só à Cloudflare, em form-urlencoded', async () => {
    const fetchImpl = ok({ success: true })
    expect(await verifyTurnstileToken({ token: 'tok', secret: 'sec', fetchImpl })).toBe('ok')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toBe('secret=sec&response=tok')
  })

  it('success=false → rejected', async () => {
    expect(await verifyTurnstileToken({ token: 't', secret: 's', fetchImpl: ok({ success: false, 'error-codes': ['invalid-input-response'] }) })).toBe('rejected')
  })

  it.each([
    ['HTTP 500', () => ok({}, 500)],
    ['HTTP 403', () => ok({}, 403)],
    ['resposta sem success', () => ok({ foo: 1 })],
    ['success não booleano', () => ok({ success: 'true' })],
    ['JSON inválido', () => vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))],
    ['erro de rede', () => vi.fn().mockRejectedValue(new Error('network'))],
    ['timeout', () => vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))],
  ])('%s → unavailable (FAIL-CLOSED: nunca vira ok)', async (_label, factory) => {
    expect(await verifyTurnstileToken({ token: 't', secret: 's', fetchImpl: factory() })).toBe('unavailable')
  })

  it.each([
    ['token vazio', { token: '', secret: 's' }],
    ['secret vazia', { token: 't', secret: '' }],
  ])('%s → rejected sem chamar a rede', async (_label, input) => {
    const fetchImpl = vi.fn()
    expect(await verifyTurnstileToken({ ...input, fetchImpl })).toBe('rejected')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('nunca registra token/secret (nenhum console.*)', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    await verifyTurnstileToken({ token: 'tok', secret: 'sec', fetchImpl: vi.fn().mockRejectedValue(new Error('x')) })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('Resend (sendEmail)', () => {
  const email = { to: 'a@example.com', subject: 's', html: '<p>x</p>', text: 'x', idempotencyKey: 'signup-1' }

  it('POST autenticado com Bearer, Idempotency-Key e corpo com from/to/subject/html/text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"id":"e1"}', { status: 200 }))
    await sendEmail(email, { apiKey: 're_secret', from: 'Numora <n@x.com>', fetchImpl })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer re_secret')
    expect(init.headers['Idempotency-Key']).toBe('signup-1')
    expect(JSON.parse(init.body)).toEqual({ from: 'Numora <n@x.com>', to: ['a@example.com'], subject: 's', html: '<p>x</p>', text: 'x' })
  })

  it('a Idempotency-Key é limitada a 256 caracteres', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await sendEmail({ ...email, idempotencyKey: 'k'.repeat(400) }, { apiKey: 'k', from: 'f', fetchImpl })
    expect(fetchImpl.mock.calls[0][1].headers['Idempotency-Key']).toHaveLength(256)
  })

  it.each([
    [401, 'rejected'],
    [422, 'rejected'],
    [429, 'unavailable'],
    [500, 'unavailable'],
  ])('HTTP %i → EmailSendError(%s) com mensagem FIXA (sem corpo, chave ou destinatário)', async (status, category) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"invalid api key re_secret for a@example.com"}', { status }))
    const error = await sendEmail(email, { apiKey: 're_secret', from: 'f', fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(EmailSendError)
    expect(error.category).toBe(category)
    expect(error.status).toBe(status)
    expect(error.message).toBe('Falha ao enviar o e-mail transacional.')
    expect(JSON.stringify(error) + error.message).not.toMatch(/re_secret|a@example\.com/)
  })

  it('erro de rede → EmailSendError(unavailable)', async () => {
    const error = await sendEmail(email, { apiKey: 'k', from: 'f', fetchImpl: vi.fn().mockRejectedValue(new Error('net')) }).catch((e) => e)
    expect(error).toBeInstanceOf(EmailSendError)
    expect(error.category).toBe('unavailable')
  })
})

describe('e-mail de confirmação', () => {
  it('a URL é sempre da origem canônica com token_hash e type=signup', () => {
    const url = buildConfirmationUrl(ORIGIN, 'abc123_DEF-456')
    expect(url).toBe(`${ORIGIN}/auth/confirm?token_hash=abc123_DEF-456&type=signup`)
  })

  it('escapa caracteres na URL e no HTML (sem injeção)', () => {
    const url = buildConfirmationUrl(ORIGIN, 'a&b"c<d>')
    const email = buildSignupConfirmationEmail({ to: 'x@example.com', confirmationUrl: url, idempotencyKey: 'k' })
    expect(email.html).not.toMatch(/<d>|"c</)
    expect(email.html).toContain('&amp;')
  })

  it('não contém texto vindo de quem pediu o cadastro nem promessas jurídicas', () => {
    const email = buildSignupConfirmationEmail({ to: 'x@example.com', confirmationUrl: `${ORIGIN}/auth/confirm?token_hash=abcdefgh&type=signup`, idempotencyKey: 'k' })
    expect(email.subject).toBe('Confirme seu e-mail no Numora')
    expect(email.text).toMatch(/uma vez/)
    expect(email.text + email.html).not.toMatch(/LGPD|GDPR|em conformidade/i)
  })

  it('TOKEN_HASH_PATTERN aceita tokens plausíveis e recusa lixo', () => {
    expect(TOKEN_HASH_PATTERN.test('a'.repeat(64))).toBe(true)
    expect(TOKEN_HASH_PATTERN.test('pkce_abc-123.DEF')).toBe(true)
    for (const bad of ['', 'curto', 'com espaço aqui', 'a/b/c/d/e/f/g', '<script>alert(1)</script>', 'a'.repeat(513), "x'; drop table--"]) {
      expect(TOKEN_HASH_PATTERN.test(bad)).toBe(false)
    }
  })
})

describe('senha aleatória descartada', () => {
  it('atende à política de senha (4 classes) e é longa', () => {
    for (let i = 0; i < 20; i += 1) {
      const password = generateDiscardedPassword()
      expect(validatePassword(password).valid).toBe(true)
      expect(password.length).toBeGreaterThanOrEqual(40)
    }
  })

  it('cada chamada gera um valor diferente (CSPRNG)', () => {
    const values = new Set(Array.from({ length: 200 }, () => generateDiscardedPassword()))
    expect(values.size).toBe(200)
  })
})


describe('adaptador da Admin API (createSignupAdminPort) — B2.4.1', () => {
  function makeAdmin(overrides: {
    createUser?: unknown
    rpc?: unknown
    getUserById?: unknown
    generateLink?: unknown
    updateUserById?: unknown
    deleteUser?: unknown
  } = {}) {
    const from = vi.fn()
    const rpc = vi.fn().mockResolvedValue(overrides.rpc ?? { data: null, error: null })
    const createUser = vi.fn().mockResolvedValue(overrides.createUser ?? { data: { user: null }, error: { code: 'x', status: 500 } })
    const generateLink = vi.fn().mockResolvedValue(overrides.generateLink ?? { data: null, error: { code: 'x', status: 500 } })
    const getUserById = vi.fn().mockResolvedValue(overrides.getUserById ?? { data: { user: null }, error: null })
    const updateUserById = vi.fn().mockResolvedValue(overrides.updateUserById ?? { data: {}, error: null })
    const deleteUser = vi.fn().mockResolvedValue(overrides.deleteUser ?? { error: null })
    const client = { from, rpc, auth: { admin: { createUser, generateLink, getUserById, updateUserById, deleteUser } } } as unknown as SupabaseClient
    return { port: createSignupAdminPort(() => client), from, rpc, createUser, generateLink, getUserById, updateUserById, deleteUser }
  }

  const APP_META = { signup_flow: 'public_v1', signup_attempt_nonce: 'n-123', signup_state: 'provisioning' }

  it('o client service_role é criado sob demanda (fábrica lazy)', () => {
    const factory = vi.fn()
    createSignupAdminPort(factory as unknown as () => SupabaseClient)
    expect(factory).not.toHaveBeenCalled()
  })

  it('a porta NÃO consulta a tabela profiles em nenhuma operação (auth.users é a fonte de verdade)', async () => {
    const admin = makeAdmin({ rpc: { data: 'uid-1', error: null } })
    await admin.port.findAuthUserIdByEmail('a@example.com')
    await admin.port.getUser('u').catch(() => undefined)
    expect(admin.from).not.toHaveBeenCalled()
    expect('findProfileIdByEmail' in admin.port).toBe(false)
  })

  it('createPendingUser: cria NÃO confirmado, com user_metadata e app_metadata SEPARADOS, e devolve id/created_at', async () => {
    const admin = makeAdmin({ createUser: { data: { user: { id: 'u1', created_at: '2026-01-01T00:00:00Z' } }, error: null } })
    const result = await admin.port.createPendingUser({ email: 'a@example.com', password: 'pw', userMetadata: { name: 'A', country_code: 'BR' }, appMetadata: APP_META })

    expect(result).toEqual({ ok: true, userId: 'u1', createdAt: '2026-01-01T00:00:00Z' })
    expect(admin.createUser).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'pw',
      email_confirm: false,
      user_metadata: { name: 'A', country_code: 'BR' },
      app_metadata: APP_META,
    })
  })

  it('createPendingUser NUNCA confirma o e-mail automaticamente', async () => {
    const admin = makeAdmin({ createUser: { data: { user: { id: 'u1' } }, error: null } })
    await admin.port.createPendingUser({ email: 'a@example.com', password: 'pw', userMetadata: {}, appMetadata: APP_META })
    expect(admin.createUser.mock.calls[0][0].email_confirm).toBe(false)
  })

  it.each(['email_exists', 'user_already_exists'])('createPendingUser: erro %s → reason email_exists (este request NÃO é dono)', async (code) => {
    const admin = makeAdmin({ createUser: { data: { user: null }, error: { code, status: 422 } } })
    expect(await admin.port.createPendingUser({ email: 'a@example.com', password: 'p', userMetadata: {}, appMetadata: APP_META })).toEqual({ ok: false, reason: 'email_exists' })
  })

  it.each([
    ['500 sem código (perdedor da corrida)', { data: { user: null }, error: { status: 500 } }],
    ['erro genérico', { data: { user: null }, error: { code: 'unexpected_failure', status: 500 } }],
    ['sem usuário e sem erro', { data: { user: null }, error: null }],
  ])('createPendingUser: %s → reason failed (o handler reconsulta auth.users; nunca assume ownership)', async (_label, createUser) => {
    const admin = makeAdmin({ createUser })
    expect(await admin.port.createPendingUser({ email: 'a@example.com', password: 'p', userMetadata: {}, appMetadata: APP_META })).toEqual({ ok: false, reason: 'failed' })
  })

  it('findAuthUserIdByEmail usa a RPC autoritativa sobre auth.users e devolve o id ou null', async () => {
    const found = makeAdmin({ rpc: { data: 'uid-1', error: null } })
    expect(await found.port.findAuthUserIdByEmail('A@Example.com')).toBe('uid-1')
    expect(found.rpc).toHaveBeenCalledWith('get_auth_user_id_by_email', { p_email: 'A@Example.com' })
    for (const data of [null, '', undefined, 42, {}]) {
      expect(await makeAdmin({ rpc: { data, error: null } }).port.findAuthUserIdByEmail('x@example.com')).toBeNull()
    }
  })

  it('findAuthUserIdByEmail lança com mensagem fixa em erro (sem vazar o e-mail)', async () => {
    const admin = makeAdmin({ rpc: { data: null, error: { message: 'boom a@example.com' } } })
    const error = await admin.port.findAuthUserIdByEmail('a@example.com').catch((e: Error) => e)
    expect((error as Error).message).toBe('Falha ao consultar o cadastro existente.')
  })

  it('generateSignupLink: sucesso devolve id e token (nunca action_link/email_otp); passa type=signup, senha, data e redirectTo', async () => {
    const admin = makeAdmin({
      generateLink: { data: { user: { id: 'u1' }, properties: { hashed_token: 'hash', verification_type: 'signup', action_link: 'https://x', email_otp: '123456' } }, error: null },
    })
    const result = await admin.port.generateSignupLink({ email: 'a@example.com', password: 'pw', data: { a: 'b' }, redirectTo: `${ORIGIN}/auth/confirm` })
    expect(result).toEqual({ ok: true, userId: 'u1', tokenHash: 'hash' })
    expect(admin.generateLink).toHaveBeenCalledWith({ type: 'signup', email: 'a@example.com', password: 'pw', options: { data: { a: 'b' }, redirectTo: `${ORIGIN}/auth/confirm` } })
    expect(JSON.stringify(result)).not.toMatch(/action_link|email_otp|123456/)
  })

  it('generateSignupLink SEM data (reemissão) não envia `data` — não sobrescreve user_metadata', async () => {
    const admin = makeAdmin({ generateLink: { data: { user: { id: 'u1' }, properties: { hashed_token: 'h', verification_type: 'signup' } }, error: null } })
    await admin.port.generateSignupLink({ email: 'a@example.com', password: 'pw', redirectTo: 'r' })
    expect(admin.generateLink.mock.calls[0][0].options).toEqual({ redirectTo: 'r' })
  })

  it.each(['email_exists', 'user_already_exists'])('generateSignupLink: erro %s → reason email_exists', async (code) => {
    const admin = makeAdmin({ generateLink: { data: null, error: { code, status: 422 } } })
    expect(await admin.port.generateSignupLink({ email: 'a@example.com', password: 'p', redirectTo: 'r' })).toEqual({ ok: false, reason: 'email_exists' })
  })

  it.each([
    ['erro genérico', { data: null, error: { code: 'unexpected_failure', status: 500 } }],
    ['sem token', { data: { user: { id: 'u' }, properties: { verification_type: 'signup' } }, error: null }],
    ['tipo de verificação inesperado', { data: { user: { id: 'u' }, properties: { hashed_token: 'h', verification_type: 'magiclink' } }, error: null }],
    ['sem usuário', { data: { user: null, properties: { hashed_token: 'h', verification_type: 'signup' } }, error: null }],
  ])('generateSignupLink: %s → reason failed (fail-closed)', async (_label, generateLink) => {
    const admin = makeAdmin({ generateLink })
    expect(await admin.port.generateSignupLink({ email: 'a@example.com', password: 'p', redirectTo: 'r' })).toEqual({ ok: false, reason: 'failed' })
  })

  it('getUser lê a ownership SÓ de app_metadata (marcador + nonce + estado) — user_metadata forjada não conta', async () => {
    const owned = makeAdmin({
      getUserById: { data: { user: { id: 'u', email_confirmed_at: null, created_at: 'c', confirmation_sent_at: 's', app_metadata: APP_META, user_metadata: {} } }, error: null },
    })
    expect(await owned.port.getUser('u')).toEqual({
      id: 'u',
      confirmed: false,
      createdAt: 'c',
      confirmationSentAt: 's',
      ownedByPublicFlow: true,
      attemptNonce: 'n-123',
      state: 'provisioning',
    })

    // marcador só em user_metadata (o próprio usuário consegue escrever ali) → NÃO é do fluxo
    const forged = makeAdmin({
      getUserById: { data: { user: { id: 'u', email_confirmed_at: null, app_metadata: { provider: 'email' }, user_metadata: { signup_flow: 'public_v1', signup_attempt_nonce: 'x' } } }, error: null },
    })
    const info = await forged.port.getUser('u')
    expect(info?.ownedByPublicFlow).toBe(false)
    expect(info?.attemptNonce).toBeNull()
  })

  it('readOwnership: marcador sem nonce, nonce vazio ou marcador diferente NÃO comprovam origem pública', () => {
    expect(readOwnership({ signup_flow: 'public_v1' }).ownedByPublicFlow).toBe(false)
    expect(readOwnership({ signup_flow: 'public_v1', signup_attempt_nonce: '' }).ownedByPublicFlow).toBe(false)
    expect(readOwnership({ signup_flow: 'public_v2', signup_attempt_nonce: 'n' }).ownedByPublicFlow).toBe(false)
    expect(readOwnership({ signup_flow: 'public_v1', signup_attempt_nonce: 123 }).ownedByPublicFlow).toBe(false)
    expect(readOwnership(null)).toEqual({ ownedByPublicFlow: false, attemptNonce: null, state: null })
    expect(readOwnership({ signup_flow: 'public_v1', signup_attempt_nonce: 'n', signup_state: 'ready' })).toEqual({ ownedByPublicFlow: true, attemptNonce: 'n', state: 'ready' })
    expect(readOwnership({ signup_state: 'qualquer-coisa' }).state).toBeNull()
  })

  it('getUser: confirmado é reportado; 404 → null; outro erro lança com mensagem fixa', async () => {
    const confirmed = makeAdmin({ getUserById: { data: { user: { id: 'u', email_confirmed_at: '2026-01-01', app_metadata: APP_META } }, error: null } })
    expect((await confirmed.port.getUser('u'))?.confirmed).toBe(true)
    expect(await makeAdmin({ getUserById: { data: { user: null }, error: { status: 404 } } }).port.getUser('u')).toBeNull()
    await expect(makeAdmin({ getUserById: { data: { user: null }, error: { status: 500 } } }).port.getUser('u')).rejects.toThrow('Falha ao consultar o usuário.')
  })

  it('markReady faz merge parcial de app_metadata (só signup_state) e lança com mensagem fixa em erro', async () => {
    const ok = makeAdmin()
    await ok.port.markReady('u1')
    expect(ok.updateUserById).toHaveBeenCalledWith('u1', { app_metadata: { signup_state: 'ready' } })
    await expect(makeAdmin({ updateUserById: { data: null, error: { message: 'x' } } }).port.markReady('u1')).rejects.toThrow('Falha ao concluir o cadastro.')
  })

  it('deleteUser lança com mensagem fixa em erro', async () => {
    await expect(makeAdmin({ deleteUser: { error: { message: 'x' } } }).port.deleteUser('u')).rejects.toThrow('Falha ao remover a conta.')
    await expect(makeAdmin().port.deleteUser('u')).resolves.toBeUndefined()
  })
})
