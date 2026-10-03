/**
 * tests/unit/signup-rate-limit.test.ts — Etapa "B2.5.4 — Rate limiting do signup".
 * Helpers puros (IP confiável, normalização, chaves opacas), o handler REAL com
 * limiter simulado (janela fixa em memória, mesma semântica da RPC) e checagens
 * estáticas do código/migration. A atomicidade contra o Postgres real está em
 * tests/integration/signup-rate-limit.test.ts.
 *
 * Mapa dos requisitos A–Q:
 *   A,B,C,D,E,F,G,H,I,L,M,N,O,P,Q → describes "handler — …" abaixo (cada `it` traz a letra)
 *   J,K                           → describe "handler — nenhum segredo/token em resposta, log ou Sentry"
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

import { createClient } from '@supabase/supabase-js'

import { createSignupRateLimiterPort } from '@/lib/auth/signup-adapters'
import { handleSignupRequest, type SignupAdminPort, type SignupHandlerDeps } from '@/lib/auth/signup-handler'
import {
  getTrustedClientIp,
  normalizeClientIp,
  normalizeEmailForRateLimit,
  rateLimitBucketKey,
  SIGNUP_RATE_LIMIT_TIMEOUT_MS,
  SIGNUP_RATE_LIMITS,
  type SignupRateLimiterPort,
} from '@/lib/auth/signup-rate-limit'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { createInMemoryRateLimiter } from '../support/signup-rate-limiter'

const ROOT = path.resolve(__dirname, '../..')
const readCode = (file: string) =>
  readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const ORIGIN = 'https://app.numora.test'
const BASE_ENV = {
  SIGNUP_ENABLED: 'true',
  NEXT_PUBLIC_SITE_URL: ORIGIN,
  RESEND_API_KEY: 're_key_do_not_leak',
  RESEND_FROM_EMAIL: 'Numora <no-reply@numora.test>',
  VERCEL: '1',
}
const CAPTCHA_ENV = { ...BASE_ENV, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'turnstile-secret-do-not-leak' }
const CAPTCHA_TOKEN = 'cf-turnstile-token-SEGREDO-123'
const NONCE = 'nonce-of-this-request'
let nowMs = 1_000_000

beforeEach(() => {
  captureException.mockReset()
  nowMs = 1_000_000
})

function payload(email: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'Maria',
    email,
    countryCode: 'BR',
    termsAccepted: true,
    privacyAccepted: true,
    age18Confirmed: true,
    marketingOptIn: false,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
    ...extra,
  }
}

function request(email: string, options: { ip?: string; extra?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: ORIGIN }
  if (options.ip) headers['x-vercel-forwarded-for'] = options.ip
  return new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers, body: JSON.stringify(payload(email, options.extra)) })
}

function setup(options: { env?: Record<string, string | undefined>; limiter?: SignupRateLimiterPort; verdict?: 'ok' | 'rejected' | 'unavailable'; sendEmail?: SignupHandlerDeps['sendEmail'] } = {}) {
  const order: string[] = []
  const memory = createInMemoryRateLimiter(() => nowMs)
  const base = options.limiter ?? memory.port
  const limiter: SignupRateLimiterPort = {
    async consume(input) {
      order.push(input.bucketKey.startsWith('ip:') ? 'rl-ip' : 'rl-email')
      return base.consume(input)
    },
  }
  const admin = {
    createPendingUser: vi.fn<SignupAdminPort['createPendingUser']>(async () => {
      order.push('create')
      return { ok: true, userId: 'u1', createdAt: new Date().toISOString() }
    }),
    findAuthUserIdByEmail: vi.fn<SignupAdminPort['findAuthUserIdByEmail']>(async () => null),
    getUser: vi.fn<SignupAdminPort['getUser']>(async () => ({
      id: 'u1', confirmed: false, createdAt: null, confirmationSentAt: null, ownedByPublicFlow: true, attemptNonce: NONCE, state: 'provisioning',
    })),
    generateSignupLink: vi.fn<SignupAdminPort['generateSignupLink']>(async () => ({ ok: true, userId: 'u1', tokenHash: 'th_0123456789abcdef' })),
    markReady: vi.fn<SignupAdminPort['markReady']>(async () => undefined),
    deleteUser: vi.fn<SignupAdminPort['deleteUser']>(async () => undefined),
  }
  const verifyCaptcha = vi.fn(async () => {
    order.push('turnstile')
    return options.verdict ?? 'ok'
  })
  const recordConsents = vi.fn<SignupHandlerDeps['recordConsents']>(async () => undefined)
  const sendEmail = vi.fn<SignupHandlerDeps['sendEmail']>(async (email, config) => {
    if (options.sendEmail) await options.sendEmail(email, config)
  })
  const deps: SignupHandlerDeps = {
    env: options.env ?? BASE_ENV,
    admin,
    rateLimiter: limiter,
    verifyCaptcha,
    recordConsents,
    sendEmail,
    generateNonce: () => NONCE,
    generatePassword: () => 'Discarded-Pass-1!',
    now: () => nowMs,
    requestId: 'req-1',
  }
  return { deps, admin, verifyCaptcha, recordConsents, sendEmail, order, memory }
}

const OK = { status: 200, body: { ok: true, needsEmailConfirmation: true } }

describe('normalizeClientIp / getTrustedClientIp — IP confiável', () => {
  it('IPv4 → o próprio endereço; lista de proxies → só o primeiro', () => {
    expect(normalizeClientIp('203.0.113.9')).toBe('203.0.113.9')
    expect(normalizeClientIp(' 203.0.113.9 , 10.0.0.1')).toBe('203.0.113.9')
  })

  it('IPv6 → prefixo /64: girar o sufixo não escapa do bucket; /64 diferente → bucket diferente', () => {
    const a = normalizeClientIp('2001:db8:abcd:12::1')
    expect(a).toBe('2001:db8:abcd:12::/64')
    expect(normalizeClientIp('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff')).toBe(a)
    expect(normalizeClientIp('2001:db8:abcd:13::1')).not.toBe(a)
    expect(normalizeClientIp('[2001:db8:abcd:12::1]')).toBe(a)
    expect(normalizeClientIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('IPv4 mapeado em IPv6 → o IPv4', () => {
    expect(normalizeClientIp('::ffff:198.51.100.7')).toBe('198.51.100.7')
  })

  it.each(['', 'unknown', 'abc', '999.1.1.1', '1.2.3', '2001:db8::zz', '<script>', "1.1.1.1'; drop table x;--"])('valor inválido %j → null', (value) => {
    expect(normalizeClientIp(value)).toBeNull()
  })

  it('só confia em x-vercel-forwarded-for DENTRO da Vercel (VERCEL=1); fora dela o header forjado é ignorado', () => {
    const forged = new Headers({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' })
    expect(getTrustedClientIp(forged, { VERCEL: '1' })).toBe('203.0.113.9')
    expect(getTrustedClientIp(forged, {})).toBeNull()
    expect(getTrustedClientIp(forged, { VERCEL: '0' })).toBeNull()
  })

  it('x-forwarded-for e x-real-ip NUNCA são usados (manipuláveis), mesmo na Vercel', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' })
    expect(getTrustedClientIp(headers, { VERCEL: '1' })).toBeNull()
  })
})

describe('normalizeEmailForRateLimit / rateLimitBucketKey', () => {
  it('H: maiúsculas, espaços e +tag caem no mesmo endereço normalizado', () => {
    const base = normalizeEmailForRateLimit('maria@example.com')
    expect(normalizeEmailForRateLimit('  MARIA@Example.COM ')).toBe(base)
    expect(normalizeEmailForRateLimit('maria+promo@example.com')).toBe(base)
    expect(normalizeEmailForRateLimit('maria+a+b@example.com')).toBe(base)
    expect(normalizeEmailForRateLimit('outra@example.com')).not.toBe(base)
    expect(normalizeEmailForRateLimit('maria@outro.com')).not.toBe(base)
    expect(normalizeEmailForRateLimit('+tag@example.com')).toBe('+tag@example.com')
  })

  it('a chave é um hash opaco: nenhum IP/e-mail em claro, determinística e separada por tipo', () => {
    const emailKey = rateLimitBucketKey('email', 'maria@example.com')
    const ipKey = rateLimitBucketKey('ip', '203.0.113.9')
    expect(emailKey).toMatch(/^email:[0-9a-f]{64}$/)
    expect(ipKey).toMatch(/^ip:[0-9a-f]{64}$/)
    expect(emailKey).not.toContain('maria')
    expect(ipKey).not.toContain('203')
    expect(rateLimitBucketKey('email', 'maria@example.com')).toBe(emailKey)
    expect(rateLimitBucketKey('ip', 'maria@example.com').slice(3)).not.toBe(emailKey.slice(6))
    expect(emailKey.length).toBeLessThanOrEqual(200)
  })
})

describe('handler — primeira requisição e limite por IP (A, B, C, D, F)', () => {
  it('A: a primeira requisição é permitida e o fluxo normal acontece', async () => {
    const { deps, admin } = setup()
    expect(await handleSignupRequest(request('a@example.com', { ip: '203.0.113.9' }), deps)).toEqual(OK)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(1)
  })

  it('B: o limite do IP é atingido → 429 neutro, sem criar conta, sem Turnstile', async () => {
    const { deps, admin, verifyCaptcha } = setup({ env: CAPTCHA_ENV })
    const ok = (i: number) => handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), deps)
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) expect((await ok(i)).status).toBe(200)

    const blocked = await ok(99)
    expect(blocked.status).toBe(429)
    expect(blocked.body).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(admin.createPendingUser).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.ip.limit)
    expect(verifyCaptcha).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.ip.limit)
  })

  it('C: o 429 traz Retry-After inteiro, entre 1 e a janela, e a janela reabre depois dele', async () => {
    const { deps } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9' }), deps)

    nowMs += 60_000
    const blocked = await handleSignupRequest(request('x@example.com', { ip: '203.0.113.9' }), deps)
    const retryAfter = Number(blocked.headers?.['Retry-After'])
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBe(SIGNUP_RATE_LIMITS.ip.windowSeconds - 60)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(SIGNUP_RATE_LIMITS.ip.windowSeconds)

    nowMs += retryAfter * 1000
    expect((await handleSignupRequest(request('y@example.com', { ip: '203.0.113.9' }), deps)).status).toBe(200)
  })

  it('respostas que não são 429 não trazem Retry-After', async () => {
    const { deps } = setup()
    expect((await handleSignupRequest(request('a@example.com', { ip: '203.0.113.9' }), deps)).headers).toBeUndefined()
  })

  it('D: outro IP → outro bucket (o IP esgotado não afeta os demais)', async () => {
    const { deps } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9' }), deps)
    expect((await handleSignupRequest(request('z@example.com', { ip: '203.0.113.9' }), deps)).status).toBe(429)
    expect((await handleSignupRequest(request('z@example.com', { ip: '203.0.113.10' }), deps)).status).toBe(200)
  })

  it('F: um burst do mesmo IP é limitado', async () => {
    const { deps } = setup()
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => handleSignupRequest(request(`burst${i}@example.com`, { ip: '203.0.113.9' }), deps)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(SIGNUP_RATE_LIMITS.ip.limit)
    expect(results.filter((r) => r.status === 429)).toHaveLength(30 - SIGNUP_RATE_LIMITS.ip.limit)
  })

  it('sem IP confiável (fora da Vercel / header ausente) → um único bucket estrito, nunca "sem limite"', async () => {
    const { deps } = setup({ env: { ...BASE_ENV, VERCEL: undefined } })
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: `203.0.113.${i + 1}` }), deps)
    expect((await handleSignupRequest(request('z@example.com', { ip: '203.0.113.200' }), deps)).status).toBe(429)
  })
})

describe('handler — limite por e-mail (E, H, I)', () => {
  it('E: o mesmo e-mail estoura em 3 tentativas → resposta NEUTRA 200, sem criar/reemitir/enviar', async () => {
    const { deps, admin, sendEmail, recordConsents } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.email.limit; i += 1) expect(await handleSignupRequest(request('maria@example.com', { ip: `203.0.113.${i + 1}` }), deps)).toEqual(OK)
    admin.createPendingUser.mockClear()
    sendEmail.mockClear()
    recordConsents.mockClear()

    expect(await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.50' }), deps)).toEqual(OK)
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    expect(admin.generateSignupLink).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.email.limit)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordConsents).not.toHaveBeenCalled()
  })

  it('E: e-mail diferente (mesmo IP) → bucket próprio, segue permitido', async () => {
    const { deps, admin } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.email.limit + 1; i += 1) await handleSignupRequest(request('maria@example.com', { ip: `203.0.113.${i + 1}` }), deps)
    admin.createPendingUser.mockClear()
    expect(await handleSignupRequest(request('joao@example.com', { ip: '203.0.113.60' }), deps)).toEqual(OK)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(1)
  })

  it('H: variações do mesmo endereço (caixa, espaços, +tag) compartilham o bucket', async () => {
    const { deps, admin } = setup()
    const variants = ['maria@example.com', 'MARIA@example.com', 'maria+a@example.com', ' maria+b@EXAMPLE.com ']
    for (const [i, email] of variants.entries()) await handleSignupRequest(request(email, { ip: `203.0.113.${i + 1}` }), deps)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.email.limit)
  })

  it('a janela do e-mail reabre depois de 60 min', async () => {
    const { deps, admin } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.email.limit + 1; i += 1) await handleSignupRequest(request('maria@example.com', { ip: `203.0.113.${i + 1}` }), deps)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.email.limit)

    nowMs += SIGNUP_RATE_LIMITS.email.windowSeconds * 1000
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.99' }), deps)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.email.limit + 1)
  })

  it('I: nada revela a existência da conta — 429 idêntico para qualquer e-mail, sem eco, sem e-mail nem contagem', async () => {
    const { deps } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9' }), deps)

    const first = await handleSignupRequest(request('existente@example.com', { ip: '203.0.113.9' }), deps)
    const second = await handleSignupRequest(request('inexistente@example.com', { ip: '203.0.113.9' }), deps)
    expect(first.status).toBe(429)
    expect(second.body).toEqual(first.body)
    const text = JSON.stringify(first)
    expect(text).not.toMatch(/example\.com|existente|\d+\s*tentativas|restam|remaining|bucket|"limit"|ip:|email:/i)
  })

  it('I: o limite do e-mail é indistinguível de um cadastro novo (mesmo corpo, mesmo status, sem headers)', async () => {
    const { deps } = setup()
    const normal = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.1' }), deps)
    for (let i = 1; i < SIGNUP_RATE_LIMITS.email.limit; i += 1) await handleSignupRequest(request('maria@example.com', { ip: `203.0.113.${i + 1}` }), deps)
    const limited = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.70' }), deps)
    expect(limited).toEqual(normal)
  })
})

describe('handler — concorrência (G)', () => {
  it('G: 25 requisições simultâneas do mesmo IP → exatamente o limite entra; os demais recebem 429', async () => {
    const { deps, admin } = setup()
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => handleSignupRequest(request(`c${i}@example.com`, { ip: '203.0.113.9' }), deps)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(SIGNUP_RATE_LIMITS.ip.limit)
    expect(results.filter((r) => r.status === 429)).toHaveLength(15)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.ip.limit)
  })

  it('G: 8 requisições simultâneas do mesmo e-mail (IPs distintos) → só o limite chega à criação', async () => {
    const { deps, admin } = setup()
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => handleSignupRequest(request('maria@example.com', { ip: `203.0.113.${i + 1}` }), deps)))
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(admin.createPendingUser).toHaveBeenCalledTimes(SIGNUP_RATE_LIMITS.email.limit)
  })
})

describe('handler — ordem: o limite vem antes de qualquer criação (O)', () => {
  it('O: IP → Turnstile → e-mail → createPendingUser', async () => {
    const { deps, order } = setup({ env: CAPTCHA_ENV })
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), deps)
    expect(order.slice(0, 4)).toEqual(['rl-ip', 'turnstile', 'rl-email', 'create'])
  })

  it('O: IP bloqueado → nem Turnstile, nem limite de e-mail, nem criação', async () => {
    const { deps, order } = setup({ env: CAPTCHA_ENV })
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), deps)
    order.length = 0
    await handleSignupRequest(request('x@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), deps)
    expect(order).toEqual(['rl-ip'])
  })

  it('Turnstile recusado → o bucket do e-mail NÃO é consumido (quem não resolve o desafio não esgota o e-mail alheio)', async () => {
    const { deps, order, memory } = setup({ env: CAPTCHA_ENV, verdict: 'rejected' })
    for (let i = 0; i < 6; i += 1) await handleSignupRequest(request('vitima@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), deps)
    expect(order.filter((step) => step === 'rl-email')).toHaveLength(0)
    expect([...memory.buckets.keys()].filter((key) => key.startsWith('email:'))).toHaveLength(0)
  })

  it('o signup fecha ANTES do limiter: nenhuma chamada ao banco do limiter quando a flag não está ligada (Q)', async () => {
    const { deps, order } = setup({ env: { ...BASE_ENV, SIGNUP_ENABLED: undefined } })
    const result = await handleSignupRequest(request('a@example.com', { ip: '203.0.113.9' }), deps)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'signup_closed' })
    expect(order).toEqual([])
  })

  it('Q: configuração incompleta/Origin inválido também respondem antes do limiter', async () => {
    const incomplete = setup({ env: { ...BASE_ENV, RESEND_API_KEY: undefined } })
    expect((await handleSignupRequest(request('a@example.com', { ip: '203.0.113.9' }), incomplete.deps)).status).toBe(503)
    expect(incomplete.order).toEqual([])

    const wrongOrigin = setup()
    const forged = new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(payload('a@example.com')) })
    expect((await handleSignupRequest(forged, wrongOrigin.deps)).status).toBe(403)
    expect(wrongOrigin.order).toEqual([])
  })

  it('a ordem no código-fonte: IP < leitura do corpo < Turnstile < e-mail < createPendingUser', () => {
    const code = readCode('lib/auth/signup-handler.ts')
    const at = (needle: string) => code.indexOf(needle)
    expect(at('consumeSignupIpLimit(deps.rateLimiter')).toBeGreaterThan(-1)
    expect(at('consumeSignupIpLimit(')).toBeLessThan(at('await readJsonBody(request)'))
    expect(at('await readJsonBody(request)')).toBeLessThan(at('deps.verifyCaptcha('))
    expect(at('deps.verifyCaptcha(')).toBeLessThan(at('await consumeSignupEmailLimit('))
    expect(at('await consumeSignupEmailLimit(')).toBeLessThan(at('deps.admin.createPendingUser('))
  })
})

describe('handler — falha do backend do limiter (P: fail-closed)', () => {
  const failing = (error: Error = new Error('connection refused to db for maria@example.com')): SignupRateLimiterPort => ({
    consume: async () => {
      throw error
    },
  })

  it('P: limiter de IP indisponível → 503, nada é criado, enviado ou consultado', async () => {
    const { deps, admin, verifyCaptcha, sendEmail, recordConsents } = setup({ limiter: failing() })
    const result = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), deps)
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, code: 'signup_unavailable' })
    expect(admin.createPendingUser).not.toHaveBeenCalled()
    expect(admin.findAuthUserIdByEmail).not.toHaveBeenCalled()
    expect(verifyCaptcha).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordConsents).not.toHaveBeenCalled()
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('P: limiter de e-mail indisponível (IP ok) → 503, nada é criado', async () => {
    let calls = 0
    const limiter: SignupRateLimiterPort = {
      consume: async () => {
        calls += 1
        if (calls === 1) return { allowed: true, retryAfterSeconds: 0 }
        throw new Error('db down')
      },
    }
    const { deps, admin } = setup({ limiter })
    const result = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), deps)
    expect(result.status).toBe(503)
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('P: a falha nunca libera o signup, mesmo repetida', async () => {
    const { deps, admin } = setup({ limiter: failing() })
    for (let i = 0; i < 5; i += 1) expect((await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9' }), deps)).status).toBe(503)
    expect(admin.createPendingUser).not.toHaveBeenCalled()
  })

  it('P: o handler não aceita ser montado sem limiter (dependência obrigatória no tipo)', () => {
    const code = readCode('lib/auth/signup-handler.ts')
    expect(code).toMatch(/\n\s*rateLimiter: SignupRateLimiterPort\n/)
    expect(code).not.toMatch(/rateLimiter\?:/)
    expect(code).not.toMatch(/deps\.rateLimiter\s*\?/)
  })

  describe('adaptador createSignupRateLimiterPort', () => {
    const adapterFor = (result: { data?: unknown; error?: unknown }) => {
      const abortSignal = vi.fn((signal: AbortSignal) => {
        void signal
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
      })
      const rpc = vi.fn(() => ({ abortSignal }))
      return { rpc, abortSignal, port: createSignupRateLimiterPort(() => ({ rpc }) as never) }
    }

    it('chama a RPC atômica com os parâmetros e devolve a decisão', async () => {
      const { rpc, port } = adapterFor({ data: [{ allowed: false, retry_after_seconds: 42 }] })
      expect(await port.consume({ bucketKey: 'ip:abc', limit: 10, windowSeconds: 900 })).toEqual({ allowed: false, retryAfterSeconds: 42 })
      expect(rpc).toHaveBeenCalledWith('consume_signup_rate_limit', { p_bucket: 'ip:abc', p_limit: 10, p_window_seconds: 900 })
    })

    it('a requisição leva um AbortSignal (o abort cancela a chamada HTTP de verdade)', async () => {
      const { abortSignal, port } = adapterFor({ data: [{ allowed: true, retry_after_seconds: 0 }] })
      await port.consume({ bucketKey: 'ip:abc', limit: 10, windowSeconds: 900 })
      expect(abortSignal).toHaveBeenCalledTimes(1)
      expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
    })

    it.each([
      ['erro do Supabase', { error: { message: 'boom' } }],
      ['sem linhas', { data: [] }],
      ['resposta malformada', { data: [{ allowed: 'yes', retry_after_seconds: '1' }] }],
      ['sem dados', {}],
    ])('P: %s → lança (o handler falha fechado), com mensagem genérica', async (_label, result) => {
      const { port } = adapterFor(result)
      await expect(port.consume({ bucketKey: 'ip:abc', limit: 10, windowSeconds: 900 })).rejects.toThrow('Falha ao consultar o limite de tentativas.')
    })
  })
})

describe('handler — timeout explícito do limiter (F2)', () => {
  const TIMEOUT_MS = 25
  const ALLOWED = { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Cliente cuja RPC responde (`ok`) ou NUNCA responde e ignora o abort (`hang`), por chamada, na ordem. */
  function rpcClient(behaviors: Array<'ok' | 'hang'>) {
    let call = 0
    const rpc = vi.fn(() => {
      const behavior = behaviors[Math.min(call, behaviors.length - 1)]
      call += 1
      return { abortSignal: () => (behavior === 'ok' ? Promise.resolve(ALLOWED) : new Promise(() => {})) }
    })
    return { rpc, limiter: createSignupRateLimiterPort(() => ({ rpc }) as never, { timeoutMs: TIMEOUT_MS }) }
  }

  const assertNothingHappened = (ctx: ReturnType<typeof setup>) => {
    expect(ctx.admin.createPendingUser).not.toHaveBeenCalled() // D
    expect(ctx.admin.findAuthUserIdByEmail).not.toHaveBeenCalled()
    expect(ctx.admin.generateSignupLink).not.toHaveBeenCalled()
    expect(ctx.sendEmail).not.toHaveBeenCalled() // E
    expect(ctx.recordConsents).not.toHaveBeenCalled() // G
    expect(ctx.admin.getUser).not.toHaveBeenCalled() // H: nada foi criado, então nada é relido nem revertido
    expect(ctx.admin.deleteUser).not.toHaveBeenCalled() // H
    expect(ctx.admin.markReady).not.toHaveBeenCalled()
  }

  it('A: RPC responde dentro do prazo → comportamento normal (200), uma chamada por dimensão', async () => {
    const { rpc, limiter } = rpcClient(['ok'])
    const ctx = setup({ limiter })
    expect(await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), ctx.deps)).toEqual(OK)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(ctx.admin.createPendingUser).toHaveBeenCalledTimes(1)
  })

  it('B: RPC do IP trava → 503 signup_unavailable em tempo limitado (a Promise nunca fica pendente)', async () => {
    const { limiter } = rpcClient(['hang'])
    const ctx = setup({ limiter })
    const started = Date.now()
    const result = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), ctx.deps)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, code: 'signup_unavailable' })
    expect(result.headers).toBeUndefined()
  })

  it('B: RPC do e-mail trava (IP ok) → 503 signup_unavailable', async () => {
    const { limiter } = rpcClient(['ok', 'hang'])
    const ctx = setup({ limiter })
    const result = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), ctx.deps)
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, code: 'signup_unavailable' })
    assertNothingHappened(ctx)
  })

  it('C: o timeout NÃO gera retry (uma única chamada por dimensão, mesmo esperando muito além do prazo)', async () => {
    const ip = rpcClient(['hang'])
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), setup({ limiter: ip.limiter }).deps)
    const email = rpcClient(['ok', 'hang'])
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), setup({ limiter: email.limiter }).deps)

    await wait(TIMEOUT_MS * 6)
    expect(ip.rpc).toHaveBeenCalledTimes(1)
    expect(email.rpc).toHaveBeenCalledTimes(2)
  })

  it('D/E/G/H: com o limiter do IP travado nada é criado, enviado, gravado, relido ou revertido (nem Turnstile)', async () => {
    const { limiter } = rpcClient(['hang'])
    const ctx = setup({ env: CAPTCHA_ENV, limiter })
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), ctx.deps)
    assertNothingHappened(ctx)
    expect(ctx.verifyCaptcha).not.toHaveBeenCalled()
  })

  it('F: o Sentry recebe só o erro genérico do timeout, sem e-mail, token nem secret', async () => {
    const { limiter } = rpcClient(['hang'])
    const ctx = setup({ env: CAPTCHA_ENV, limiter })
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), ctx.deps)

    expect(captureException).toHaveBeenCalledTimes(1)
    const sent = JSON.stringify(captureException.mock.calls)
    expect(sent).toContain('signup_rate_limit')
    const captured = captureException.mock.calls[0][0] as Error
    expect(captured.message).toBe('Tempo esgotado ao consultar o limite de tentativas.')
    const everything = `${sent} ${captured.name} ${captured.message} ${captured.stack ?? ''}`
    for (const secret of [CAPTCHA_TOKEN, 'maria@example.com', 'turnstile-secret-do-not-leak', 're_key_do_not_leak', NONCE]) expect(everything).not.toContain(secret)
  })

  it('o abort chega à requisição HTTP real do supabase-js e o timeout vale mesmo com o cliente de verdade', async () => {
    let aborted = false
    let fetchCalls = 0
    const hangingFetch = ((_url: unknown, init?: RequestInit) => {
      fetchCalls += 1
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }) as typeof fetch
    const client = createClient('http://localhost:54321', 'chave-de-teste-nao-e-secret', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: hangingFetch },
    })

    const limiter = createSignupRateLimiterPort(() => client, { timeoutMs: TIMEOUT_MS })
    await expect(limiter.consume({ bucketKey: 'ip:abc', limit: 10, windowSeconds: 900 })).rejects.toThrow(/Tempo esgotado|Falha ao consultar/)
    await wait(TIMEOUT_MS * 2)
    expect(fetchCalls).toBe(1)
    expect(aborted).toBe(true)
  })

  it('o timeout é finito, curto e envolve SÓ o limiter (nenhum timeout global no handler; sem retry no adaptador)', () => {
    expect(Number.isFinite(SIGNUP_RATE_LIMIT_TIMEOUT_MS)).toBe(true)
    expect(SIGNUP_RATE_LIMIT_TIMEOUT_MS).toBeGreaterThan(0)
    expect(SIGNUP_RATE_LIMIT_TIMEOUT_MS).toBeLessThanOrEqual(5000)

    const handler = readCode('lib/auth/signup-handler.ts')
    expect(handler).not.toMatch(/AbortSignal|AbortController|setTimeout|Promise\.race/)

    const adapters = readCode('lib/auth/signup-adapters.ts')
    expect(adapters).toMatch(/\.abortSignal\(controller\.signal\)/)
    expect(adapters).toMatch(/clearTimeout\(timer\)/)
    expect(adapters).not.toMatch(/\battempt\b|while \(|for \(let|retries|retry\(/)
  })
})

describe('documentação — pseudonimização, não anonimização (F6)', () => {
  const files = ['lib/auth/signup-rate-limit.ts', 'lib/auth/signup-adapters.ts', 'supabase/migrations/20260927130000_create_signup_rate_limits.sql']

  it('nenhum arquivo do limiter afirma "sem PII" ou chama o hash de anônimo', () => {
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8')
      expect(text, file).not.toMatch(/sem PII|não (?:tem|contém) PII/i)
    }
  })

  it('o cabeçalho do módulo e a migration dizem que é PSEUDONIMIZAÇÃO (hash sem pepper), com IP/e-mail nunca em claro', () => {
    for (const file of ['lib/auth/signup-rate-limit.ts', 'supabase/migrations/20260927130000_create_signup_rate_limits.sql']) {
      const text = readFileSync(path.join(ROOT, file), 'utf8')
      expect(text, file).toMatch(/PSEUDONIMIZA/i)
      expect(text, file).toMatch(/sem pepper/i)
      expect(text, file).toMatch(/em claro/)
      expect(text, file).toMatch(/não anonimiza|anonimização|não anônimo/i)
    }
  })

  it('o COMMENT ON TABLE descreve a chave como dado pseudonimizado', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/20260927130000_create_signup_rate_limits.sql'), 'utf8')
    const comment = sql.match(/comment on table public\.signup_rate_limits is\s+'([^']+)'/)?.[1] ?? ''
    expect(comment).toMatch(/PSEUDONIMIZADO/)
    expect(comment).toMatch(/nunca são gravados em claro/)
    expect(comment).not.toMatch(/sem PII/i)
  })
})

describe('handler — nenhum segredo/token em resposta, log ou Sentry (J, K)', () => {
  const sensitive = [CAPTCHA_TOKEN, 'turnstile-secret-do-not-leak', 're_key_do_not_leak', NONCE, 'Discarded-Pass-1!', 'th_0123456789abcdef']

  function expectClean(label: string, value: unknown) {
    const text = JSON.stringify(value)
    for (const secret of sensitive) expect(text, `${label} vazou ${secret.slice(0, 8)}…`).not.toContain(secret)
  }

  it('J/K: nas respostas 200, 429 e 503 e nos buckets do limiter', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const happy = setup({ env: CAPTCHA_ENV })
    const results = []
    for (let i = 0; i <= SIGNUP_RATE_LIMITS.ip.limit; i += 1) {
      results.push(await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), happy.deps))
    }
    expect(results.at(-1)?.status).toBe(429)
    expectClean('respostas', results)
    expectClean('chamadas ao limiter', happy.memory.calls)
    expectClean('buckets', [...happy.memory.buckets.keys()])

    const broken = setup({
      env: CAPTCHA_ENV,
      limiter: {
        consume: async () => {
          throw new Error(`falhou com ${CAPTCHA_TOKEN} e turnstile-secret-do-not-leak`)
        },
      },
    })
    const failed = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), broken.deps)
    expect(failed.status).toBe(503)
    expectClean('resposta 503', failed)
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    consoleSpies.forEach((spy) => spy.mockRestore())
  })

  it('J/K: o Sentry nunca recebe o e-mail do usuário nem o token quando o limiter falha', async () => {
    const { deps } = setup({
      env: CAPTCHA_ENV,
      limiter: {
        consume: async () => {
          throw new Error('timeout consultando maria@example.com')
        },
      },
    })
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9', extra: { captchaToken: CAPTCHA_TOKEN } }), deps)
    expect(captureException).toHaveBeenCalledTimes(1)
    const sent = JSON.stringify(captureException.mock.calls)
    expect(sent).not.toContain('maria@example.com')
    expect(sent).not.toContain(CAPTCHA_TOKEN)
    expect(sent).toContain('signup_rate_limit')
  })

  it('J/K: os módulos novos não registram nada (sem console/Sentry direto) e não leem secrets', () => {
    for (const file of ['lib/auth/signup-rate-limit.ts']) {
      const code = readCode(file)
      expect(code, file).not.toMatch(/console\.|Sentry|captureException/)
      expect(code, file).not.toMatch(/process\.env|SERVICE_ROLE|TURNSTILE_SECRET|RESEND_API_KEY|STRIPE_/)
    }
  })
})

describe('handler — semântica do signup preservada (L, M, N)', () => {
  it('L: ownership — a conta nasce com marcador, nonce e provisioning em app_metadata; markReady ao final', async () => {
    const { deps, admin } = setup()
    expect(await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), deps)).toEqual(OK)
    expect(admin.createPendingUser).toHaveBeenCalledWith(
      expect.objectContaining({ appMetadata: { signup_flow: 'public_v1', signup_attempt_nonce: NONCE, signup_state: 'provisioning' } }),
    )
    expect(admin.markReady).toHaveBeenCalledWith('u1')
  })

  it('M: legal consent gravado uma vez, só pelo servidor, e nunca em 429 ou no limite de e-mail', async () => {
    const { deps, recordConsents } = setup()
    await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), deps)
    expect(recordConsents).toHaveBeenCalledTimes(1)
    expect(recordConsents.mock.calls[0][0]).toBe('u1')

    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9' }), deps)
    const before = recordConsents.mock.calls.length
    await handleSignupRequest(request('blocked@example.com', { ip: '203.0.113.9' }), deps)
    expect(recordConsents.mock.calls.length).toBe(before)
  })

  it('N: rollback — falha do Resend remove a conta própria (nonce conferido) e responde 503', async () => {
    const { deps, admin } = setup({
      sendEmail: async () => {
        throw new Error('resend down')
      },
    })
    const result = await handleSignupRequest(request('maria@example.com', { ip: '203.0.113.9' }), deps)
    expect(result.status).toBe(503)
    expect(admin.deleteUser).toHaveBeenCalledTimes(1)
    expect(admin.deleteUser).toHaveBeenCalledWith('u1')
  })

  it('N: um 429 nunca dispara rollback nem exclusão (nada foi criado)', async () => {
    const { deps, admin } = setup()
    for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) await handleSignupRequest(request(`u${i}@example.com`, { ip: '203.0.113.9' }), deps)
    await handleSignupRequest(request('x@example.com', { ip: '203.0.113.9' }), deps)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })
})

describe('rota e migration (estático)', () => {
  it('a rota liga o limiter real e repassa os headers do resultado (Retry-After) à resposta', () => {
    const route = readCode('app/api/auth/signup/route.ts')
    expect(route).toMatch(/rateLimiter: createSignupRateLimiterPort\(getSupabaseAdminClient\)/)
    expect(route).toMatch(/\.\.\.result\.headers/)
  })

  it('a migration: RLS ligada, sem policies, função SECURITY DEFINER com search_path vazio, só service_role', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/20260927130000_create_signup_rate_limits.sql'), 'utf8')
    expect(sql).toMatch(/alter table public\.signup_rate_limits enable row level security/)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).toMatch(/revoke all on table public\.signup_rate_limits from public, anon, authenticated/)
    expect(sql).toMatch(/security definer\s+set search_path = ''/)
    expect(sql).toMatch(/revoke all on function public\.consume_signup_rate_limit\(text, integer, integer\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.consume_signup_rate_limit\(text, integer, integer\) to service_role/)
    expect(sql).not.toMatch(/auth\.users/)
    expect(sql).toMatch(/on conflict \(bucket_key\) do update/)
  })

  it('nenhuma coluna guarda IP/e-mail em claro: só bucket_key (hash pseudonimizado), window_start e hit_count', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/20260927130000_create_signup_rate_limits.sql'), 'utf8')
    const table = sql.match(/create table public\.signup_rate_limits \(([\s\S]*?)\n\);/)?.[1] ?? ''
    expect([...table.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1])).toEqual(['bucket_key', 'window_start', 'hit_count'])
  })
})
