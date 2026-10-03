/**
 * tests/integration/signup-rate-limit.test.ts — Etapa "B2.5.4 — Rate limiting do
 * signup" contra o Supabase DEV real (nunca Production). Prova, no Postgres:
 *  - atomicidade: N chamadas simultâneas ao mesmo bucket aceitam EXATAMENTE
 *    `limit` (sem corrida de leitura-e-escrita);
 *  - janela fixa, Retry-After coerente e reabertura depois da janela;
 *  - buckets independentes; contador limitado (sem overflow); parâmetros inválidos;
 *  - a tabela e a RPC não são acessíveis a anon/authenticated;
 *  - o handler real, com o limiter REAL, devolve 429 + Retry-After sob burst
 *    concorrente, falha fechado quando o backend do limiter falha e não toca o
 *    banco quando o signup está fechado.
 * Nenhum usuário real é criado pelo handler (porta admin simulada); os buckets
 * de teste são removidos ao final.
 */
import { randomInt } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createSignupRateLimiterPort } from '@/lib/auth/signup-adapters'
import { handleSignupRequest, type SignupAdminPort, type SignupHandlerDeps } from '@/lib/auth/signup-handler'
import { rateLimitBucketKey, SIGNUP_RATE_LIMITS, normalizeEmailForRateLimit } from '@/lib/auth/signup-rate-limit'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { createClockSkewRetryingFetch } from '../support/clock-skew-fetch'
import { createAdminClient, createAnonClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, signInAsDisposableUser, type TestEnv } from '../support/dev-env'

const ORIGIN = 'https://app.numora.test'
const ENV = { SIGNUP_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN, RESEND_API_KEY: 're_not_a_real_key', RESEND_FROM_EMAIL: 'Numora <no-reply@numora.test>', VERCEL: '1' }
const PREFIX = 'b254test'

describe.skipIf(!hasTestEnv())('rate limit do signup — DEV real (B2.5.4)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  const stamp = Date.now()
  let counter = 0
  const createdKeys = new Set<string>()
  const disposableIds: string[] = []

  const rawKey = (label: string) => {
    const key = `${PREFIX}:${stamp}:${label}:${++counter}`
    createdKeys.add(key)
    return key
  }
  const randomIp = () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
  const port = () => createSignupRateLimiterPort(() => admin)
  const consume = (input: { bucketKey: string; limit: number; windowSeconds: number }) => port().consume(input)
  const rowFor = async (key: string) => (await admin.from('signup_rate_limits').select('hit_count, window_start').eq('bucket_key', key).maybeSingle()).data
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  beforeAll(() => {
    env = getTestEnv()!
    // O DEV devolve, de forma intermitente, `PGRST303 JWT issued at future` (relógio da borda do Supabase) ANTES
    // de a função rodar. O client de teste repete SÓ essa assinatura exata (ver tests/support/clock-skew-fetch.ts);
    // qualquer outro erro — inclusive os que o adaptador converte em 503 — é propagado de imediato, sem retry.
    admin = createAdminClient(env, { fetch: createClockSkewRetryingFetch() })
  })

  afterAll(async () => {
    if (createdKeys.size > 0) await admin.from('signup_rate_limits').delete().in('bucket_key', [...createdKeys])
    for (const id of disposableIds) await deleteDisposableUser(admin, id).catch(() => {})
  })

  describe('RPC consume_signup_rate_limit', () => {
    it('atomicidade: 40 chamadas simultâneas, limite 7 → exatamente 7 permitidas e 33 negadas', async () => {
      const key = rawKey('atomic')
      const decisions = await Promise.all(Array.from({ length: 40 }, () => consume({ bucketKey: key, limit: 7, windowSeconds: 60 })))
      expect(decisions.filter((d) => d.allowed)).toHaveLength(7)
      expect(decisions.filter((d) => !d.allowed)).toHaveLength(33)
      for (const d of decisions.filter((x) => x.allowed)) expect(d.retryAfterSeconds).toBe(0)
      for (const d of decisions.filter((x) => !x.allowed)) {
        expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1)
        expect(d.retryAfterSeconds).toBeLessThanOrEqual(60)
      }
    })

    it('o contador é limitado a limit+1 (nenhum overflow, mesmo sob abuso)', async () => {
      const key = rawKey('cap')
      for (let i = 0; i < 12; i += 1) await consume({ bucketKey: key, limit: 3, windowSeconds: 60 })
      expect((await rowFor(key))?.hit_count).toBe(4)
    })

    it('buckets diferentes são independentes', async () => {
      const [a, b] = [rawKey('indep-a'), rawKey('indep-b')]
      for (let i = 0; i < 3; i += 1) await consume({ bucketKey: a, limit: 3, windowSeconds: 60 })
      expect((await consume({ bucketKey: a, limit: 3, windowSeconds: 60 })).allowed).toBe(false)
      expect((await consume({ bucketKey: b, limit: 3, windowSeconds: 60 })).allowed).toBe(true)
    })

    it('janela fixa: negado dentro da janela, Retry-After coerente e reabre depois dela', async () => {
      const key = rawKey('window')
      expect((await consume({ bucketKey: key, limit: 2, windowSeconds: 2 })).allowed).toBe(true)
      expect((await consume({ bucketKey: key, limit: 2, windowSeconds: 2 })).allowed).toBe(true)
      const denied = await consume({ bucketKey: key, limit: 2, windowSeconds: 2 })
      expect(denied).toMatchObject({ allowed: false })
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(2)

      await sleep(2300)
      expect(await consume({ bucketKey: key, limit: 2, windowSeconds: 2 })).toEqual({ allowed: true, retryAfterSeconds: 0 })
      expect((await rowFor(key))?.hit_count).toBe(1)
    }, 15_000)

    it.each([
      ['limite 0', { p_bucket: 'b254test:x', p_limit: 0, p_window_seconds: 60 }],
      ['limite acima de 1000', { p_bucket: 'b254test:x', p_limit: 1001, p_window_seconds: 60 }],
      ['janela 0', { p_bucket: 'b254test:x', p_limit: 5, p_window_seconds: 0 }],
      ['janela acima de 1 dia', { p_bucket: 'b254test:x', p_limit: 5, p_window_seconds: 86401 }],
      ['bucket vazio', { p_bucket: '', p_limit: 5, p_window_seconds: 60 }],
      ['bucket gigante', { p_bucket: 'x'.repeat(201), p_limit: 5, p_window_seconds: 60 }],
    ])('parâmetro inválido (%s) → erro 22023, nada é gravado', async (_label, args) => {
      const { error } = await admin.rpc('consume_signup_rate_limit', args)
      expect(error?.code).toBe('22023')
      expect(await rowFor(args.p_bucket)).toBeNull()
    })

    it('a chave gravada é o hash opaco: sem e-mail nem IP em claro na tabela', async () => {
      const ip = randomIp()
      const email = `numora.test.b254-pii.${stamp}@example.com`
      const keys = [rateLimitBucketKey('ip', ip), rateLimitBucketKey('email', normalizeEmailForRateLimit(email))]
      keys.forEach((key) => createdKeys.add(key))
      for (const key of keys) await consume({ bucketKey: key, limit: 5, windowSeconds: 60 })

      const { data } = await admin.from('signup_rate_limits').select('bucket_key').in('bucket_key', keys)
      expect(data).toHaveLength(2)
      for (const row of data ?? []) {
        expect(row.bucket_key).toMatch(/^(ip|email):[0-9a-f]{64}$/)
        expect(row.bucket_key).not.toContain(ip)
        expect(row.bucket_key).not.toContain('example.com')
      }
    })
  })

  describe('controle de acesso', () => {
    it('anon não executa a RPC nem lê a tabela', async () => {
      const anon = createAnonClient(env)
      const rpc = await anon.rpc('consume_signup_rate_limit', { p_bucket: rawKey('anon'), p_limit: 5, p_window_seconds: 60 })
      expect(rpc.error).not.toBeNull()
      const read = await anon.from('signup_rate_limits').select('bucket_key').limit(1)
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
    })

    it('usuário autenticado não executa a RPC, não lê, não escreve e não apaga a tabela', async () => {
      const user = await createDisposableUser(admin, 'b254-rls')
      disposableIds.push(user.id)
      const client = await signInAsDisposableUser(env, user)

      const key = rawKey('authenticated')
      expect((await client.rpc('consume_signup_rate_limit', { p_bucket: key, p_limit: 5, p_window_seconds: 60 })).error).not.toBeNull()
      const read = await client.from('signup_rate_limits').select('bucket_key').limit(1)
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
      expect((await client.from('signup_rate_limits').insert({ bucket_key: key, window_start: new Date().toISOString(), hit_count: 0 })).error).not.toBeNull()
      await client.from('signup_rate_limits').delete().eq('bucket_key', key)
      expect(await rowFor(key)).toBeNull()
    })
  })

  describe('handler real + limiter REAL (usuários simulados, nada criado no Auth)', () => {
    const body = (email: string) => ({
      name: 'Teste B254', email, countryCode: 'BR', termsAccepted: true, privacyAccepted: true, age18Confirmed: true, marketingOptIn: false,
      termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
    })
    const request = (email: string, ip: string) =>
      new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'x-vercel-forwarded-for': ip }, body: JSON.stringify(body(email)) })

    function makeDeps(options: { rateLimiter?: SignupHandlerDeps['rateLimiter']; env?: Record<string, string | undefined> } = {}) {
      const admin_: SignupAdminPort = {
        createPendingUser: async () => ({ ok: true, userId: 'sim-user', createdAt: null }),
        findAuthUserIdByEmail: async () => null,
        getUser: async () => ({ id: 'sim-user', confirmed: false, createdAt: null, confirmationSentAt: null, ownedByPublicFlow: true, attemptNonce: 'n', state: 'provisioning' }),
        generateSignupLink: async () => ({ ok: true, userId: 'sim-user', tokenHash: 'th' }),
        markReady: async () => undefined,
        deleteUser: async () => undefined,
      }
      let creates = 0
      const wrapped: SignupAdminPort = { ...admin_, createPendingUser: async (input) => { creates += 1; return admin_.createPendingUser(input) } }
      const deps: SignupHandlerDeps = {
        env: options.env ?? ENV,
        admin: wrapped,
        rateLimiter: options.rateLimiter ?? port(),
        verifyCaptcha: async () => 'ok',
        recordConsents: async () => undefined,
        sendEmail: async () => undefined,
        generateNonce: () => 'n',
      }
      return { deps, creates: () => creates }
    }

    const trackIp = (ip: string) => createdKeys.add(rateLimitBucketKey('ip', ip))
    const trackEmail = (email: string) => createdKeys.add(rateLimitBucketKey('email', normalizeEmailForRateLimit(email)))

    it('burst concorrente do mesmo IP: exatamente o limite passa, o resto leva 429 com Retry-After', async () => {
      const ip = randomIp()
      trackIp(ip)
      const total = SIGNUP_RATE_LIMITS.ip.limit + 6
      const emails = Array.from({ length: total }, (_, i) => `numora.test.b254-burst.${stamp}.${counter}.${i}@example.com`)
      emails.forEach(trackEmail)
      const { deps, creates } = makeDeps()

      const results = await Promise.all(emails.map((email) => handleSignupRequest(request(email, ip), deps)))
      expect(results.filter((r) => r.status === 200)).toHaveLength(SIGNUP_RATE_LIMITS.ip.limit)
      const blocked = results.filter((r) => r.status === 429)
      expect(blocked).toHaveLength(6)
      for (const r of blocked) {
        expect(r.body).toMatchObject({ ok: false, code: 'rate_limited' })
        const retryAfter = Number(r.headers?.['Retry-After'])
        expect(retryAfter).toBeGreaterThanOrEqual(1)
        expect(retryAfter).toBeLessThanOrEqual(SIGNUP_RATE_LIMITS.ip.windowSeconds)
      }
      expect(creates()).toBe(SIGNUP_RATE_LIMITS.ip.limit)
    }, 30_000)

    it('IP diferente tem bucket próprio mesmo com o outro esgotado', async () => {
      const [ipA, ipB] = [randomIp(), randomIp()]
      trackIp(ipA)
      trackIp(ipB)
      const { deps } = makeDeps()
      for (let i = 0; i < SIGNUP_RATE_LIMITS.ip.limit; i += 1) {
        const email = `numora.test.b254-ip.${stamp}.${counter}.${i}@example.com`
        trackEmail(email)
        await handleSignupRequest(request(email, ipA), deps)
      }
      const blocked = await handleSignupRequest(request(`numora.test.b254-ip.${stamp}.x@example.com`, ipA), deps)
      expect(blocked.status).toBe(429)
      const email = `numora.test.b254-ip.${stamp}.other@example.com`
      trackEmail(email)
      expect((await handleSignupRequest(request(email, ipB), deps)).status).toBe(200)
    }, 30_000)

    it('o mesmo e-mail (variações) estoura no limite por e-mail com resposta neutra e sem criar', async () => {
      const email = `numora.test.b254-mail.${stamp}.${counter}@example.com`
      trackEmail(email)
      const { deps, creates } = makeDeps()
      const variants = [email, email.toUpperCase(), email.replace('@', '+promo@'), ` ${email} `]
      const results = []
      for (const variant of variants) {
        const ip = randomIp()
        trackIp(ip)
        results.push(await handleSignupRequest(request(variant, ip), deps))
      }
      expect(results.every((r) => r.status === 200)).toBe(true)
      expect(creates()).toBe(SIGNUP_RATE_LIMITS.email.limit)
    }, 30_000)

    it('backend do limiter indisponível (RPC negada) → 503 e nada é criado (fail-closed)', async () => {
      const ip = randomIp()
      const { deps, creates } = makeDeps({ rateLimiter: createSignupRateLimiterPort(() => createAnonClient(env)) })
      const result = await handleSignupRequest(request(`numora.test.b254-down.${stamp}@example.com`, ip), deps)
      expect(result.status).toBe(503)
      expect(result.body).toMatchObject({ ok: false, code: 'signup_unavailable' })
      expect(creates()).toBe(0)
    })

    it('signup fechado → 403 e o banco do limiter nem é consultado', async () => {
      const ip = randomIp()
      const key = rateLimitBucketKey('ip', ip)
      createdKeys.add(key)
      const { deps, creates } = makeDeps({ env: { ...ENV, SIGNUP_ENABLED: undefined } })
      const result = await handleSignupRequest(request(`numora.test.b254-closed.${stamp}@example.com`, ip), deps)
      expect(result.status).toBe(403)
      expect(creates()).toBe(0)
      expect(await rowFor(key)).toBeNull()
    })
  })
})
