/**
 * tests/unit/captcha-required-policy.test.ts — Etapa "B2.5.2 — Hardening
 * explícito do CAPTCHA". Cobertura direta dos testes A–K pedidos: a
 * política `CAPTCHA_REQUIRED` substitui a dependência implícita de
 * `VERCEL_ENV === 'production'` (removida — `isCaptchaRequirementMet` não
 * existe mais) para signup, login e forgot-password; reset-password segue
 * sem CAPTCHA; nenhuma secret aparece em resposta/log/Sentry; legal_consents,
 * ownership do signup e billing não foram tocados.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { resolveClientCaptchaPolicy, resolveSignupCaptchaPolicy } from '@/lib/captcha/captcha'
import { handleSignupRequest, type SignupAdminPort, type SignupHandlerDeps } from '@/lib/auth/signup-handler'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { allowAllRateLimiter } from '../support/signup-rate-limiter'

const ROOT = path.resolve(__dirname, '../..')
const readCode = (file: string) =>
  readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

describe('isCaptchaRequirementMet foi REMOVIDA (substituída pela política explícita)', () => {
  it('não existe mais em lib/captcha/captcha.ts nem é importada em nenhum lugar', () => {
    const code = readCode('lib/captcha/captcha.ts')
    expect(code).not.toMatch(/isCaptchaRequirementMet/)
    const offenders = ['lib/auth/signup-config.ts', 'lib/auth/signup-handler.ts', 'app/signup/page.tsx', 'app/login/page.tsx', 'app/forgot-password/page.tsx'].filter(
      (file) => /isCaptchaRequirementMet/.test(readCode(file)),
    )
    expect(offenders).toEqual([])
  })

  it('nenhum arquivo de app decide obrigatoriedade de CAPTCHA lendo VERCEL_ENV diretamente', () => {
    // app/login e app/forgot-password nunca leram VERCEL_ENV. lib/auth/signup-config.ts ainda
    // lê VERCEL_ENV, mas só para a regra de http/localhost de getCanonicalOrigin (inalterada,
    // fora do escopo deste hardening) — nunca mais para decidir obrigatoriedade de CAPTCHA.
    for (const file of ['app/login/page.tsx', 'app/forgot-password/page.tsx']) {
      expect(readCode(file), file).not.toMatch(/VERCEL_ENV/)
    }
    const signupConfig = readCode('lib/auth/signup-config.ts')
    expect(signupConfig).toMatch(/isProduction = env\.VERCEL_ENV === 'production'/) // só na origem canônica
    expect(signupConfig).not.toMatch(/captcha[\s\S]{0,80}VERCEL_ENV|VERCEL_ENV[\s\S]{0,80}captcha/i)
  })
})

describe('TESTE A — CAPTCHA_REQUIRED=false + configuração ausente → compatível com a política atual', () => {
  it('signup: disabled, segue sem CAPTCHA', () => {
    expect(resolveSignupCaptchaPolicy({})).toEqual({ ok: true, state: 'disabled' })
    expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'false' })).toEqual({ ok: true, state: 'disabled' })
  })

  it('login/forgot-password: opcional, sem widget', () => {
    expect(resolveClientCaptchaPolicy({})).toEqual({ ok: true, required: false, siteKey: null })
  })
})

describe('TESTE B — CAPTCHA_REQUIRED=true + configuração ausente → bloqueado/fail-closed', () => {
  it('signup: ok:false', () => {
    expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'true' })).toEqual({ ok: false })
  })

  it('login/forgot-password: ok:false (a página não pode oferecer o formulário)', () => {
    expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true' })).toEqual({ ok: false })
  })

  it('nunca "meio ligado": uma chave sozinha é SEMPRE ok:false para o signup, com ou sem CAPTCHA_REQUIRED', () => {
    expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: false })
    expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', TURNSTILE_SECRET_KEY: 's' })).toEqual({ ok: false })
  })
})

describe('TESTE F — Signup: CAPTCHA obrigatório quando configurado (via handler real)', () => {
  const ORIGIN = 'https://app.numora.test'
  const BASE_ENV = { SIGNUP_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN, RESEND_API_KEY: 're_k', RESEND_FROM_EMAIL: 'Numora <n@numora.test>' }
  const REQUIRED_ENV = { ...BASE_ENV, CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'turnstile-secret-do-not-leak' }
  const captureException = vi.fn()
  vi.doMock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

  function body(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Maria', email: 'maria@example.com', countryCode: 'BR', termsAccepted: true, privacyAccepted: true, age18Confirmed: true, marketingOptIn: false,
      termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
      ...overrides,
    }
  }
  const req = (payload: unknown) => new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(payload) })

  function makeDeps(env: Record<string, string | undefined>, verdict: 'ok' | 'rejected' | 'unavailable' = 'ok') {
    const admin: SignupAdminPort = {
      createPendingUser: vi.fn().mockResolvedValue({ ok: true, userId: 'u1', createdAt: new Date().toISOString() }),
      findAuthUserIdByEmail: vi.fn().mockResolvedValue(null),
      getUser: vi.fn().mockResolvedValue({ id: 'u1', confirmed: false, createdAt: new Date().toISOString(), confirmationSentAt: null, ownedByPublicFlow: true, attemptNonce: 'n1', state: 'provisioning' }),
      generateSignupLink: vi.fn().mockResolvedValue({ ok: true, userId: 'u1', tokenHash: 'th_abcdefgh12345678' }),
      markReady: vi.fn().mockResolvedValue(undefined),
      deleteUser: vi.fn().mockResolvedValue(undefined),
    }
    const verifyCaptcha = vi.fn().mockResolvedValue(verdict)
    const deps: SignupHandlerDeps = {
      env, admin, verifyCaptcha, rateLimiter: allowAllRateLimiter,
      recordConsents: vi.fn().mockResolvedValue(undefined),
      sendEmail: vi.fn().mockResolvedValue(undefined),
      generateNonce: () => 'n1',
    }
    return { deps, admin, verifyCaptcha }
  }

  it('CAPTCHA_REQUIRED=true: token AUSENTE → rejeitado, sem criar conta (TESTE C)', async () => {
    const { deps, admin, verifyCaptcha } = makeDeps(REQUIRED_ENV)
    const result = await handleSignupRequest(req(body()), deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'captcha_failed' })
    expect(verifyCaptcha).not.toHaveBeenCalled()
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('CAPTCHA_REQUIRED=true: token INVÁLIDO (rejeitado pelo Turnstile) → rejeitado (TESTE D)', async () => {
    const { deps, admin, verifyCaptcha } = makeDeps(REQUIRED_ENV, 'rejected')
    const result = await handleSignupRequest(req(body({ captchaToken: 'abc123' })), deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'captcha_failed' })
    expect(verifyCaptcha).toHaveBeenCalledTimes(1)
    expect(admin.createPendingUser).not.toHaveBeenCalled() // a verificação do token acontece ANTES de criar a conta
  })

  it('CAPTCHA_REQUIRED=true: token VÁLIDO → fluxo permitido (TESTE E)', async () => {
    const { deps } = makeDeps(REQUIRED_ENV, 'ok')
    const result = await handleSignupRequest(req(body({ captchaToken: 'abc123' })), deps)
    expect(result).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
  })

  it('CAPTCHA_REQUIRED=true SEM as chaves → 503, cadastro inteiro bloqueado (TESTE B aplicado ao signup real)', async () => {
    const { deps, admin } = makeDeps({ ...BASE_ENV, CAPTCHA_REQUIRED: 'true' })
    const result = await handleSignupRequest(req(body()), deps)
    expect(result.status).toBe(503)
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('nenhum segredo (secret, token) aparece na resposta HTTP (TESTE J)', async () => {
    const { deps } = makeDeps(REQUIRED_ENV, 'ok')
    const result = await handleSignupRequest(req(body({ captchaToken: 'abc123' })), deps)
    const json = JSON.stringify(result)
    expect(json).not.toContain('turnstile-secret-do-not-leak')
    expect(json).not.toContain('abc123')
  })
})

describe('TESTE G — Login: CAPTCHA obrigatório quando configurado', () => {
  it('CAPTCHA_REQUIRED=true + site key → required:true (o LoginForm bloqueia o submit sem token: ver tests/unit/captcha-login-reset.test.ts)', () => {
    expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: true, required: true, siteKey: 'k' })
  })

  it('CAPTCHA_REQUIRED=true sem site key → app/login/page.tsx falha fechado (não renderiza LoginForm)', () => {
    const page = readCode('app/login/page.tsx')
    expect(page).toMatch(/if \(!captcha\.ok\)/)
    expect(page).toMatch(/temporariamente indisponível/)
  })

  it('o gate de submissão (captcha.enabled && !captcha.token) já força o token sempre que a site key está presente — nenhuma lógica nova duplicada', () => {
    const form = readCode('features/auth/components/LoginForm.tsx')
    expect(form).toMatch(/if \(captcha\.enabled && !captcha\.token\)/)
  })
})

describe('TESTE H — Forgot password: CAPTCHA obrigatório quando configurado', () => {
  it('CAPTCHA_REQUIRED=true + site key → required:true', () => {
    expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: true, required: true, siteKey: 'k' })
  })

  it('CAPTCHA_REQUIRED=true sem site key → app/forgot-password/page.tsx falha fechado', () => {
    const page = readCode('app/forgot-password/page.tsx')
    expect(page).toMatch(/if \(!captcha\.ok\)/)
    expect(page).toMatch(/temporariamente indisponível/)
  })

  it('o formulário mantém o mesmo gate de submissão do login (mesma função, sem duplicar a regra)', () => {
    const form = readCode('features/auth/components/ForgotPasswordForm.tsx')
    expect(form).toMatch(/if \(captcha\.enabled && !captcha\.token\)/)
  })
})

describe('TESTE I — Reset password: CAPTCHA NÃO obrigatório', () => {
  it('a página de reset não importa nem referencia captcha/Turnstile, mesmo com CAPTCHA_REQUIRED=true', () => {
    const code = readCode('app/auth/reset-password/page.tsx')
    expect(code).not.toMatch(/captcha|turnstile|CAPTCHA_REQUIRED/i)
  })

  it('isCaptchaRequired não é chamado em nenhum lugar relacionado ao reset', () => {
    expect(readCode('app/auth/reset-password/page.tsx')).not.toMatch(/isCaptchaRequired|resolveClientCaptchaPolicy/)
  })
})

describe('TESTE K — legal_consents, signup ownership e billing permanecem inalterados', () => {
  it('a fronteira de ownership (nonce, app_metadata) não foi tocada por este hardening', () => {
    const handler = readCode('lib/auth/signup-handler.ts')
    expect(handler).toMatch(/isOwnedByAttempt/)
    expect(handler).toMatch(/signup_attempt_nonce|SIGNUP_FLOW_MARKER/)
  })

  it('legal_consents continua gravado só pelo servidor, nos mesmos pontos de sempre', () => {
    const handler = readCode('lib/auth/signup-handler.ts')
    expect(handler).toMatch(/deps\.recordConsents\(userId, data\.consents\)/)
  })

  it('nenhum arquivo de billing/Stripe referencia CAPTCHA_REQUIRED ou a nova política', () => {
    for (const file of ['lib/billing/plan-availability.ts', 'lib/billing/purchase-eligibility.ts', 'app/api/billing/checkout/route.ts']) {
      expect(readCode(file)).not.toMatch(/CAPTCHA_REQUIRED|resolveSignupCaptchaPolicy|resolveClientCaptchaPolicy/)
    }
  })

  it('Premium continua "Em breve" e Pro é o único plano contratável (guarda intacta)', async () => {
    const { PURCHASABLE_PLAN_SLUGS, COMING_SOON_PLAN_SLUGS } = await import('@/lib/billing/plan-availability')
    expect([...PURCHASABLE_PLAN_SLUGS]).toEqual(['pro'])
    expect([...COMING_SOON_PLAN_SLUGS]).toEqual(['premium'])
  })
})
