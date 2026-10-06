/**
 * tests/unit/legal-acceptance-gate.test.ts — Etapa "B2.5.7 (Bloco A)".
 * Gate de aceite legal do signup público, provado PELO HANDLER REAL (o servidor é a autoridade
 * final; o formulário só espelha a validação) e pela função que grava `legal_consents`. Nenhum
 * código de produção foi criado ou alterado para este bloco: o gate já existe
 * (validateSignupPayload → buildSignupConsents → recordSignupConsents, depois da prova de
 * ownership do B2.4.1). Aqui ficam os 10 casos pedidos, cada um com teste próprio e explícito:
 *
 *   1 Terms ausente → rejeita            6 valores válidos → aceita
 *   2 Privacy ausente → rejeita          7 marketing false → continua válido
 *   3 18+ ausente → rejeita              8 bypass só pelo client → rejeita no servidor
 *   4 versão de Terms incorreta → rejeita 9 usuário criado pertence ao signup attempt correto
 *   5 versão de Privacy incorreta → rejeita 10 consentimento pertence ao usuário correto
 *
 * Os documentos seguem `pending_legal_review`: nada aqui altera texto, versão ou status jurídico.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

import { handleSignupRequest, type AuthUserInfo, type SignupAdminPort, type SignupHandlerDeps } from '@/lib/auth/signup-handler'
import { buildSignupConsents, recordSignupConsents, SIGNUP_CONSENT_SOURCE } from '@/lib/legal/signup-consents'
import { AGE_CONFIRMATION_VERSION, MARKETING_OPT_IN_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { allowAllRateLimiter } from '../support/signup-rate-limiter'

const ROOT = path.resolve(__dirname, '../..')
const readCode = (file: string) =>
  readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const ORIGIN = 'https://app.numora.test'
const ENV = { SIGNUP_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN, RESEND_API_KEY: 're_test_key', RESEND_FROM_EMAIL: 'Numora <no-reply@numora.test>' }

function payload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria',
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

const request = (body: unknown) =>
  new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) })

/** Admin simulado que se comporta como o real: cada createPendingUser devolve um id novo e guarda o nonce recebido. */
function setup(options: { reread?: (id: string, nonce: string | null) => AuthUserInfo | null; recordConsentsFails?: boolean } = {}) {
  let sequence = 0
  let nonceSequence = 0
  const nonceById = new Map<string, string>()
  const events: string[] = []

  const admin = {
    createPendingUser: vi.fn<SignupAdminPort['createPendingUser']>(async ({ appMetadata }) => {
      sequence += 1
      const id = `user-${sequence}`
      nonceById.set(id, appMetadata.signup_attempt_nonce)
      events.push(`create:${id}`)
      return { ok: true, userId: id, createdAt: null }
    }),
    findAuthUserIdByEmail: vi.fn<SignupAdminPort['findAuthUserIdByEmail']>(async () => null),
    getUser: vi.fn<SignupAdminPort['getUser']>(async (id) => {
      events.push(`getUser:${id}`)
      const nonce = nonceById.get(id) ?? null
      if (options.reread) return options.reread(id, nonce)
      return { id, confirmed: false, createdAt: null, confirmationSentAt: null, ownedByPublicFlow: true, attemptNonce: nonce, state: 'provisioning' }
    }),
    generateSignupLink: vi.fn<SignupAdminPort['generateSignupLink']>(async ({ email }) => {
      const id = [...nonceById.keys()].at(-1) as string
      void email
      return { ok: true, userId: id, tokenHash: 'th_0123456789abcdef' }
    }),
    markReady: vi.fn<SignupAdminPort['markReady']>(async () => undefined),
    deleteUser: vi.fn<SignupAdminPort['deleteUser']>(async (id) => {
      events.push(`delete:${id}`)
    }),
  }
  const recordConsents = vi.fn<SignupHandlerDeps['recordConsents']>(async (userId) => {
    events.push(`consents:${userId}`)
    if (options.recordConsentsFails) throw new Error('db down')
  })
  const sendEmail = vi.fn<SignupHandlerDeps['sendEmail']>(async () => {
    events.push('email')
  })
  const deps: SignupHandlerDeps = {
    env: ENV,
    admin,
    rateLimiter: allowAllRateLimiter,
    verifyCaptcha: async () => 'ok',
    recordConsents,
    sendEmail,
    generateNonce: () => `nonce-${++nonceSequence}`,
    generatePassword: () => 'Discarded-Pass-1!',
  }
  return { deps, admin, recordConsents, sendEmail, events, nonceById }
}

type Ctx = ReturnType<typeof setup>
const expectNothingCreated = (ctx: Ctx) => {
  expect(ctx.admin.createPendingUser).not.toHaveBeenCalled()
  expect(ctx.admin.findAuthUserIdByEmail).not.toHaveBeenCalled()
  expect(ctx.admin.generateSignupLink).not.toHaveBeenCalled()
  expect(ctx.recordConsents).not.toHaveBeenCalled()
  expect(ctx.sendEmail).not.toHaveBeenCalled()
  expect(ctx.admin.deleteUser).not.toHaveBeenCalled()
}

beforeEach(() => captureException.mockReset())

describe('1 — Terms ausente → rejeita (no servidor)', () => {
  it.each([undefined, false, null, 'true', 1, 'on'])('termsAccepted=%j → 400 terms_required, nada criado, nada gravado', async (value) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ termsAccepted: value })), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code: 'terms_required' })
    expectNothingCreated(ctx)
  })
})

describe('2 — Privacy ausente → rejeita', () => {
  it.each([undefined, false, null, 'true', 1])('privacyAccepted=%j → 400 privacy_required, nada criado, nada gravado', async (value) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ privacyAccepted: value })), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code: 'privacy_required' })
    expectNothingCreated(ctx)
  })
})

describe('3 — 18+ ausente → rejeita', () => {
  it.each([undefined, false, null, 'true', 1, 'yes'])('age18Confirmed=%j → 400 age_confirmation_required, nada criado, nada gravado', async (value) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ age18Confirmed: value })), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code: 'age_confirmation_required' })
    expectNothingCreated(ctx)
  })
})

describe('4 — versão de Terms incorreta → rejeita', () => {
  it.each([
    ['antiga', '2020-01-01'],
    ['ausente', undefined],
    ['vazia', ''],
    ['de outro documento (Privacy não é Terms)', 'privacy-2026'],
    ['não string', 20260925],
    ['com sufixo (versão vigente + lixo)', `${TERMS_VERSION}-x`],
  ])('termsVersion %s → 400 documents_outdated, nada criado, nada gravado', async (_label, version) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ termsVersion: version })), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code: 'documents_outdated' })
    expectNothingCreated(ctx)
  })
})

describe('5 — versão de Privacy incorreta → rejeita (e a do 18+ também)', () => {
  it.each([
    ['antiga', '2020-01-01'],
    ['ausente', undefined],
    ['vazia', ''],
    ['não string', 1],
    ['com sufixo', `${PRIVACY_VERSION}-x`],
  ])('privacyVersion %s → 400 documents_outdated, nada criado, nada gravado', async (_label, version) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ privacyVersion: version })), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code: 'documents_outdated' })
    expectNothingCreated(ctx)
  })

  it.each([undefined, '0', '', 2])('ageConfirmationVersion=%j → 400 documents_outdated, nada criado', async (version) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ ageConfirmationVersion: version })), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, code: 'documents_outdated' })
    expectNothingCreated(ctx)
  })
})

describe('6 — valores válidos → aceita e grava o aceite', () => {
  it('200 neutro; consentimentos gravados UMA vez, de uma só vez, com as versões vigentes do servidor', async () => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload()), ctx.deps)

    expect(result).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
    expect(ctx.recordConsents).toHaveBeenCalledTimes(1)
    expect(ctx.recordConsents).toHaveBeenCalledWith('user-1', [
      { documentType: 'terms', documentVersion: TERMS_VERSION },
      { documentType: 'privacy', documentVersion: PRIVACY_VERSION },
      { documentType: 'age_18', documentVersion: AGE_CONFIRMATION_VERSION },
    ])
  })

  it('o aceite só é gravado DEPOIS de provar o ownership e ANTES do e-mail', async () => {
    const ctx = setup()
    await handleSignupRequest(request(payload()), ctx.deps)
    const order = ctx.events
    expect(order.indexOf('create:user-1')).toBeLessThan(order.indexOf('getUser:user-1'))
    expect(order.indexOf('getUser:user-1')).toBeLessThan(order.indexOf('consents:user-1'))
    expect(order.indexOf('consents:user-1')).toBeLessThan(order.indexOf('email'))
  })
})

describe('7 — marketing é separado e opcional', () => {
  it.each([false, undefined, null, 'true', 1, 'on'])('marketingOptIn=%j → cadastro válido, SEM marketing_email', async (value) => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ marketingOptIn: value })), ctx.deps)
    expect(result.status).toBe(200)
    const recorded = ctx.recordConsents.mock.calls[0][1].map((c) => c.documentType)
    expect(recorded).toEqual(['terms', 'privacy', 'age_18'])
  })

  it('só `true` estrito vira marketing_email, como consentimento SEPARADO com a sua própria versão', async () => {
    const ctx = setup()
    await handleSignupRequest(request(payload({ marketingOptIn: true })), ctx.deps)
    const consents = ctx.recordConsents.mock.calls[0][1]
    expect(consents).toHaveLength(4)
    expect(consents.at(-1)).toEqual({ documentType: 'marketing_email', documentVersion: MARKETING_OPT_IN_VERSION })
  })

  it('marketing nunca substitui um obrigatório: marketing true sem Terms continua rejeitado', async () => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ marketingOptIn: true, termsAccepted: false })), ctx.deps)
    expect(result.body).toMatchObject({ code: 'terms_required' })
    expectNothingCreated(ctx)
  })
})

describe('8 — bypass somente pelo client → rejeita no servidor', () => {
  it('chamada direta à API (sem o formulário) com todo o aceite negado → 400 e nada acontece', async () => {
    const ctx = setup()
    const result = await handleSignupRequest(request(payload({ termsAccepted: false, privacyAccepted: false, age18Confirmed: false })), ctx.deps)
    expect(result.status).toBe(400)
    expectNothingCreated(ctx)
  })

  it('chamada direta com corpo "mínimo" (só nome, e-mail e país — o que um script mandaria) → rejeita', async () => {
    const ctx = setup()
    const result = await handleSignupRequest(request({ name: 'Maria', email: 'maria@example.com', countryCode: 'BR' }), ctx.deps)
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'terms_required' })
    expectNothingCreated(ctx)
  })

  it('campos que fingem aceite no payload (consents, legal_consents, user_metadata, source, versões extras) são IGNORADOS: o servidor grava só o que ele mesmo constrói', async () => {
    const ctx = setup()
    const result = await handleSignupRequest(
      request(
        payload({
          consents: [{ documentType: 'cookies', documentVersion: 'forjada' }],
          legal_consents: [{ document_type: 'terms', document_version: 'forjada' }],
          user_metadata: { terms_version: 'forjada', age_18_version: 'forjada' },
          app_metadata: { signup_flow: 'forjada' },
          source: 'admin',
          acceptedAt: '1999-01-01T00:00:00Z',
        }),
      ),
      ctx.deps,
    )

    expect(result.status).toBe(200)
    expect(ctx.recordConsents).toHaveBeenCalledWith('user-1', buildSignupConsents(false))
    expect(JSON.stringify(ctx.recordConsents.mock.calls)).not.toContain('forjada')
    expect(JSON.stringify(ctx.admin.createPendingUser.mock.calls)).not.toContain('forjada')
  })

  it('o formulário e o servidor usam a MESMA validação, mas só a do servidor decide: ela roda antes de qualquer criação', () => {
    const form = readCode('features/auth/components/SignupForm.tsx')
    const handler = readCode('lib/auth/signup-handler.ts')
    expect(form).toMatch(/validateSignupPayload\(payload\)/) // espelho de UX
    expect(handler).toMatch(/validateSignupPayload\(payload\)/) // autoridade
    expect(handler.indexOf('validateSignupPayload(payload)')).toBeLessThan(handler.indexOf('deps.admin.createPendingUser('))
    expect(handler).toMatch(/deps\.recordConsents\(userId, data\.consents\)/)
  })

  it('o formulário nunca pré-marca o aceite e não envia metadata jurídica ao Supabase', () => {
    const form = readCode('features/auth/components/SignupForm.tsx')
    expect(form).toMatch(/useState\(false\)[\s\S]*useState\(false\)[\s\S]*useState\(false\)[\s\S]*useState\(false\)/)
    expect(form).not.toMatch(/user_metadata|raw_user_meta_data|legal_consents/)
  })
})

describe('9 — o usuário criado pertence ao signup attempt correto', () => {
  it('a conta nasce com o nonce DESTE request em app_metadata (server-only) e o aceite só segue com a prova', async () => {
    const ctx = setup()
    await handleSignupRequest(request(payload()), ctx.deps)

    expect(ctx.admin.createPendingUser).toHaveBeenCalledTimes(1)
    expect(ctx.admin.createPendingUser.mock.calls[0][0].appMetadata).toEqual({
      signup_flow: 'public_v1',
      signup_attempt_nonce: 'nonce-1',
      signup_state: 'provisioning',
    })
    expect(ctx.nonceById.get('user-1')).toBe('nonce-1')
    expect(ctx.recordConsents).toHaveBeenCalledTimes(1)
  })

  it('dois cadastros: cada conta guarda o nonce do SEU request', async () => {
    const ctx = setup()
    await handleSignupRequest(request(payload({ email: 'a@example.com' })), ctx.deps)
    await handleSignupRequest(request(payload({ email: 'b@example.com' })), ctx.deps)
    expect(ctx.nonceById.get('user-1')).toBe('nonce-1')
    expect(ctx.nonceById.get('user-2')).toBe('nonce-2')
  })

  it('ownership NÃO comprovado (nonce diferente) → nenhum aceite gravado, nenhum e-mail, e a conta NÃO é apagada', async () => {
    const ctx = setup({
      reread: (id) => ({ id, confirmed: false, createdAt: null, confirmationSentAt: null, ownedByPublicFlow: true, attemptNonce: 'nonce-de-outro-request', state: 'provisioning' }),
    })
    const result = await handleSignupRequest(request(payload()), ctx.deps)

    expect(result.status).toBe(503)
    expect(ctx.recordConsents).not.toHaveBeenCalled()
    expect(ctx.sendEmail).not.toHaveBeenCalled()
    expect(ctx.admin.deleteUser).not.toHaveBeenCalled()
  })
})

describe('10 — o consentimento pertence ao usuário correto', () => {
  it('cada request grava o aceite para o id que ELE criou, nunca para outro', async () => {
    const ctx = setup()
    await handleSignupRequest(request(payload({ email: 'a@example.com' })), ctx.deps)
    await handleSignupRequest(request(payload({ email: 'b@example.com', marketingOptIn: true })), ctx.deps)

    expect(ctx.recordConsents.mock.calls.map((call) => call[0])).toEqual(['user-1', 'user-2'])
    expect(ctx.recordConsents.mock.calls[0][1]).toHaveLength(3)
    expect(ctx.recordConsents.mock.calls[1][1]).toHaveLength(4) // o marketing do segundo NÃO vaza para o primeiro
  })

  it('conta JÁ EXISTENTE nunca recebe aceite deste request (nem o confirmado, nem o pendente alheio)', async () => {
    const ctx = setup()
    ctx.admin.createPendingUser.mockResolvedValueOnce({ ok: false, reason: 'email_exists' })
    ctx.admin.findAuthUserIdByEmail.mockResolvedValueOnce('existing-1')
    ctx.admin.getUser.mockResolvedValueOnce({ id: 'existing-1', confirmed: true, createdAt: null, confirmationSentAt: null, ownedByPublicFlow: false, attemptNonce: null, state: null })

    const result = await handleSignupRequest(request(payload()), ctx.deps)
    expect(result).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
    expect(ctx.recordConsents).not.toHaveBeenCalled()
  })
})

describe('atomicidade — sem usuário sem aceite, sem aceite parcial', () => {
  it('falha ao gravar o aceite → conta própria REMOVIDA (nonce conferido), e-mail NUNCA enviado, 503 neutro', async () => {
    const ctx = setup({ recordConsentsFails: true })
    const result = await handleSignupRequest(request(payload()), ctx.deps)

    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, code: 'signup_unavailable' })
    expect(ctx.sendEmail).not.toHaveBeenCalled()
    expect(ctx.admin.deleteUser).toHaveBeenCalledWith('user-1')
    expect(ctx.events.indexOf('consents:user-1')).toBeLessThan(ctx.events.indexOf('delete:user-1'))
    expect(JSON.stringify(result)).not.toContain('db down')
  })

  it('recordSignupConsents grava TODAS as linhas num único upsert (uma instrução = tudo ou nada), todas para o mesmo usuário, source "signup"', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const from = vi.fn(() => ({ upsert }))
    await recordSignupConsents({ from } as never, 'user-xyz', buildSignupConsents(true))

    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('legal_consents')
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, options] = upsert.mock.calls[0] as unknown as [Array<Record<string, string>>, Record<string, unknown>]
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(['user-xyz']))
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set([SIGNUP_CONSENT_SOURCE]))
    expect(rows.map((r) => r.document_type)).toEqual(['terms', 'privacy', 'age_18', 'marketing_email'])
    expect(options).toEqual({ onConflict: 'user_id,document_type,document_version', ignoreDuplicates: true })
  })

  it('erro do banco → mensagem fixa (nunca o texto do banco) e nenhuma segunda tentativa', async () => {
    const upsert = vi.fn(async () => ({ error: { message: 'duplicate key value violates "secret detail"' } }))
    await expect(recordSignupConsents({ from: () => ({ upsert }) } as never, 'u', buildSignupConsents(false))).rejects.toThrow('Falha ao registrar os consentimentos legais do cadastro.')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('nenhum IP, user-agent, token ou segredo entra nas linhas de consentimento (só usuário, tipo, versão, origem)', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    await recordSignupConsents({ from: () => ({ upsert }) } as never, 'u', buildSignupConsents(true))
    const rows = (upsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0]
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['document_type', 'document_version', 'source', 'user_id'])
  })

  it('sem mecanismo paralelo: legal_consents só é escrita por lib/legal/signup-consents.ts', () => {
    const writers = ['lib/auth/signup-handler.ts', 'lib/auth/signup-adapters.ts', 'app/api/auth/signup/route.ts', 'features/auth/components/SignupForm.tsx']
    for (const file of writers) expect(readCode(file), file).not.toMatch(/from\(['"]legal_consents['"]\)|insert into public\.legal_consents/)
    expect(readCode('lib/legal/signup-consents.ts')).toMatch(/from\('legal_consents'\)/)
  })
})
