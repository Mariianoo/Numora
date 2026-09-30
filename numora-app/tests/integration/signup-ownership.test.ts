/**
 * tests/integration/signup-ownership.test.ts — Etapa "B2.4.1 — Hardening de
 * ownership" contra o Supabase DEV real (nunca Production). Prova, com a Admin
 * API real e o handler real (só Turnstile e Resend simulados), que:
 *
 *  1. duas requisições simultâneas com o mesmo e-mail geram exatamente 1
 *     auth.user, só o dono faz rollback, o perdedor nunca apaga a conta do
 *     vencedor, não há consentimento cruzado e nenhum link válido é invalidado
 *     por rollback indevido;
 *  2. um pendente criado antes pela Admin API (sem ownership do fluxo público)
 *     NÃO é adotado — nem com `profiles.email` divergente (o caso E4 da
 *     auditoria): sem legal_consents, sem marcador, sem e-mail, sem elegibilidade
 *     para cleanup;
 *  3. erro ambíguo/timeout do Resend só causa rollback se o nonce for do
 *     request; se a ownership mudou, a conta é preservada;
 *  4. o rollback normal remove usuário, profile e consentimentos (sem resíduo);
 *  5. a reemissão legítima não troca ownership, invalida o link anterior, não
 *     usa senha do cliente e não duplica consentimento.
 *
 * Usuários descartáveis em @example.com, todos removidos ao final.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { handleConfirmRequest, type ConfirmDeps } from '@/lib/auth/confirm-signup'
import { createSignupAdminPort } from '@/lib/auth/signup-adapters'
import { handleSignupRequest, type SignupAdminPort, type SignupHandlerDeps } from '@/lib/auth/signup-handler'
import { EmailSendError, type OutgoingEmail } from '@/lib/email/resend'
import { recordSignupConsents } from '@/lib/legal/signup-consents'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { createAdminClient, createAnonClient, deleteDisposableUser, getTestEnv, hasTestEnv, type TestEnv } from '../support/dev-env'

const ORIGIN = 'https://app.numora.test'
const ENV = { SIGNUP_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN, RESEND_API_KEY: 're_not_a_real_key', RESEND_FROM_EMAIL: 'Numora <no-reply@numora.test>' }
const NEUTRAL = { status: 200, body: { ok: true, needsEmailConfirmation: true } }

describe.skipIf(!hasTestEnv())('ownership do signup público — DEV real (B2.4.1)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  const tracked = new Set<string>()
  let counter = 0
  const stamp = Date.now()

  const newEmail = (label: string) => `numora.test.b241-${label}.${stamp}.${++counter}@example.com`
  const randomPassword = () => `Np${Math.random().toString(36).slice(2)}Aa1!${Math.random().toString(36).slice(2)}`

  const body = (email: string) => ({
    name: 'Teste B241',
    email,
    countryCode: 'BR',
    termsAccepted: true,
    privacyAccepted: true,
    age18Confirmed: true,
    marketingOptIn: false,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
  })
  const request = (email: string) =>
    new Request(`${ORIGIN}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body(email)) })
  const label = (r: { status: number; body: unknown }) => `${r.status}:${(r.body as { code?: string }).code ?? 'ok'}`

  const tokenFrom = (email: OutgoingEmail): string => new URL(email.text.match(/https:\/\/app\.numora\.test\/auth\/confirm\?[^\s]+/)![0]).searchParams.get('token_hash') as string

  function confirmDeps(client: SupabaseClient): ConfirmDeps {
    return {
      env: ENV,
      async verifyOtp(tokenHash) {
        const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' })
        if (error || !data.session || !data.user) return { ok: false, kind: 'invalid' }
        return { ok: true, userId: data.user.id }
      },
    }
  }
  const confirmRequest = (token: string) =>
    new Request(`${ORIGIN}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
      body: new URLSearchParams({ token_hash: token, type: 'signup' }).toString(),
    })
  /** Usuários (auth.users) com esse e-mail, pela RPC autoritativa. */
  async function authUserId(email: string): Promise<string | null> {
    const { data } = await admin.rpc('get_auth_user_id_by_email', { p_email: email })
    const id = typeof data === 'string' && data ? data : null
    if (id) tracked.add(id)
    return id
  }
  const consentCount = async (id: string) => ((await admin.from('legal_consents').select('id').eq('user_id', id)).data ?? []).length
  const getUser = async (id: string) => (await admin.auth.admin.getUserById(id)).data.user

  interface Options {
    sendEmail?: SignupHandlerDeps['sendEmail']
    now?: () => number
    wrap?: (port: SignupAdminPort) => SignupAdminPort
    recordConsents?: SignupHandlerDeps['recordConsents']
  }
  function makeDeps(options: Options = {}) {
    const sent: OutgoingEmail[] = []
    const port = createSignupAdminPort(() => admin)
    const deps: SignupHandlerDeps = {
      env: ENV,
      admin: options.wrap ? options.wrap(port) : port,
      verifyCaptcha: async () => 'ok',
      recordConsents: options.recordConsents ?? ((userId, consents) => recordSignupConsents(admin, userId, consents)),
      sendEmail:
        options.sendEmail ??
        (async (email) => {
          sent.push(email)
        }),
      ...(options.now ? { now: options.now } : {}),
    }
    return { deps, sent }
  }

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
  })

  afterAll(async () => {
    for (const id of tracked) await deleteDisposableUser(admin, id).catch(() => undefined)
  })

  describe('TESTE 1 — duas requisições simultâneas com o mesmo e-mail', () => {
    it('5 rodadas: exatamente 1 auth.user, 1 e-mail, 3 consentimentos do dono, link válido e nenhuma cruzada', async () => {
      for (let round = 0; round < 5; round += 1) {
        const email = newEmail('race')
        const a = makeDeps()
        const b = makeDeps()
        const [ra, rb] = await Promise.all([handleSignupRequest(request(email), a.deps), handleSignupRequest(request(email), b.deps)])

        // ambos respondem igual (o perdedor recebe a resposta neutra, nunca um falso 503)
        expect([label(ra), label(rb)]).toEqual(['200:ok', '200:ok'])
        const sent = [...a.sent, ...b.sent]
        expect(sent).toHaveLength(1) // só o dono envia e-mail

        const ownerId = await authUserId(email)
        expect(ownerId).toBeTruthy()
        // exatamente 1 usuário com esse e-mail (a RPC devolve 1; profiles também)
        const { data: profiles } = await admin.from('profiles').select('id').eq('email', email)
        expect((profiles ?? []).map((p) => p.id)).toEqual([ownerId])

        // consentimentos: só do dono, sem duplicar
        expect(await consentCount(ownerId as string)).toBe(3)
        const { data: allConsents } = await admin.from('legal_consents').select('user_id').eq('user_id', ownerId as string)
        expect(new Set((allConsents ?? []).map((c) => c.user_id))).toEqual(new Set([ownerId]))

        // o link entregue continua VÁLIDO: nenhum rollback/reemissão do perdedor o invalidou
        const token = tokenFrom(sent[0])
        const confirmed = await handleConfirmRequest(confirmRequest(token), confirmDeps(createAnonClient(env)))
        expect(confirmed).toMatchObject({ kind: 'redirect', location: `${ORIGIN}/auth/set-password` })
      }
    })

    it('a falha do Resend do DONO na corrida: só o dono faz rollback da SUA conta; o perdedor não envia nem apaga nada', async () => {
      for (let round = 0; round < 3; round += 1) {
        const email = newEmail('race-fail')
        let sendAttempts = 0
        const failing: SignupHandlerDeps['sendEmail'] = async () => {
          sendAttempts += 1
          throw new EmailSendError('rejected', 422)
        }
        const a = makeDeps({ sendEmail: failing })
        const b = makeDeps({ sendEmail: failing })
        const [ra, rb] = await Promise.all([handleSignupRequest(request(email), a.deps), handleSignupRequest(request(email), b.deps)])

        expect([label(ra), label(rb)].sort()).toEqual(['200:ok', '503:signup_unavailable']) // dono: 503; perdedor: neutro
        expect(sendAttempts).toBe(1) // o perdedor NUNCA tentou enviar
        expect(await authUserId(email)).toBeNull() // o dono removeu a própria conta
        const { data: profiles } = await admin.from('profiles').select('id').eq('email', email)
        expect(profiles).toEqual([])
      }
    })

    it('dono lento (Resend demora) + segundo request chegando: o segundo NÃO reemite nem invalida; se o dono falha, só a conta do dono é apagada', async () => {
      const email = newEmail('slow-owner')
      let releaseOwner!: () => void
      const gate = new Promise<void>((resolve) => (releaseOwner = resolve))
      let ownerCreated!: () => void
      const ownerCreatedSignal = new Promise<void>((resolve) => (ownerCreated = resolve))
      let ownerGenerateCalls = 0
      let secondGenerateCalls = 0

      const owner = makeDeps({
        wrap: (port) => ({
          ...port,
          createPendingUser: async (input) => {
            const result = await port.createPendingUser(input)
            ownerCreated()
            return result
          },
          generateSignupLink: async (input) => {
            ownerGenerateCalls += 1
            return port.generateSignupLink(input)
          },
        }),
        sendEmail: async () => {
          await gate
          throw new Error('resend caiu depois de o segundo request chegar')
        },
      })
      const second = makeDeps({
        now: () => Date.now() + 10 * 60 * 1000, // sem cooldown: só o estado `provisioning` deve barrá-lo
        wrap: (port) => ({
          ...port,
          generateSignupLink: async (input) => {
            secondGenerateCalls += 1
            return port.generateSignupLink(input)
          },
        }),
      })

      const ownerRun = handleSignupRequest(request(email), owner.deps)
      await ownerCreatedSignal
      const secondResult = await handleSignupRequest(request(email), second.deps)
      expect(secondResult).toEqual(NEUTRAL)
      expect(secondGenerateCalls).toBe(0) // nenhum link emitido pelo segundo (nada invalidado)
      expect(second.sent).toHaveLength(0)

      releaseOwner()
      const ownerResult = await ownerRun
      expect(ownerResult.status).toBe(503)
      expect(ownerGenerateCalls).toBe(1)
      expect(await authUserId(email)).toBeNull() // o dono removeu a própria conta
    })

    it('dono lento cujo Resend TEM SUCESSO: o segundo request não invalida o link e a conta fica pronta', async () => {
      const email = newEmail('slow-ok')
      let releaseOwner!: () => void
      const gate = new Promise<void>((resolve) => (releaseOwner = resolve))
      let ownerCreated!: () => void
      const ownerCreatedSignal = new Promise<void>((resolve) => (ownerCreated = resolve))

      const ownerSent: OutgoingEmail[] = []
      const owner = makeDeps({
        wrap: (port) => ({ ...port, createPendingUser: async (input) => { const r = await port.createPendingUser(input); ownerCreated(); return r } }),
        sendEmail: async (message) => {
          await gate
          ownerSent.push(message)
        },
      })
      const second = makeDeps({ now: () => Date.now() + 10 * 60 * 1000 })

      const ownerRun = handleSignupRequest(request(email), owner.deps)
      await ownerCreatedSignal
      expect(await handleSignupRequest(request(email), second.deps)).toEqual(NEUTRAL)
      releaseOwner()
      expect(await ownerRun).toEqual(NEUTRAL)

      const id = (await authUserId(email)) as string
      expect((await getUser(id))?.app_metadata?.signup_state).toBe('ready')
      const confirmed = await handleConfirmRequest(confirmRequest(tokenFrom(ownerSent[0])), confirmDeps(createAnonClient(env)))
      expect(confirmed).toMatchObject({ kind: 'redirect', location: `${ORIGIN}/auth/set-password` })
      expect(second.sent).toHaveLength(0)
    })
  })

  describe('TESTE 2 — pendente criado antes pela Admin API (sem ownership do signup público)', () => {
    async function preExisting(labelName: string, extra: { nullProfileEmail?: boolean } = {}) {
      const email = newEmail(labelName)
      const { data } = await admin.auth.admin.createUser({ email, password: randomPassword(), email_confirm: false, user_metadata: { name: 'Convidado' } })
      const id = data.user!.id
      tracked.add(id)
      if (extra.nullProfileEmail) await admin.from('profiles').update({ email: null }).eq('id', id)
      return { email, id }
    }

    async function assertNotAdopted(id: string, sent: OutgoingEmail[]) {
      expect(sent).toHaveLength(0) // sem e-mail
      expect(await consentCount(id)).toBe(0) // sem legal_consents
      const user = await getUser(id)
      expect(user?.email_confirmed_at).toBeFalsy()
      expect(user?.app_metadata?.signup_flow).toBeUndefined() // sem marcador
      expect(user?.app_metadata?.signup_attempt_nonce).toBeUndefined()
      expect(user?.user_metadata?.signup_flow).toBeUndefined()
      expect(user?.user_metadata?.name).toBe('Convidado') // metadata original intacta (nada sobrescrito pelo generateLink)
      // e NÃO é elegível para cleanup, nem com corte no futuro
      const { data: listed } = await admin.rpc('list_stale_pending_public_signups', { p_cutoff: new Date(Date.now() + 3600_000).toISOString(), p_limit: 500 })
      expect(((listed ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)).not.toContain(id)
    }

    it('signup público para o e-mail de um pendente preexistente → resposta neutra e NENHUMA adoção', async () => {
      const { email, id } = await preExisting('invited')
      const { deps, sent } = makeDeps({ now: () => Date.now() + 10 * 60 * 1000 })
      expect(await handleSignupRequest(request(email), deps)).toEqual(NEUTRAL)
      await assertNotAdopted(id, sent)
    })

    it('caso E4 da auditoria (profiles.email divergente): continua NÃO adotando — a decisão vem de auth.users', async () => {
      const { email, id } = await preExisting('invited-noprofile', { nullProfileEmail: true })
      const { deps, sent } = makeDeps({ now: () => Date.now() + 10 * 60 * 1000 })
      expect(await handleSignupRequest(request(email), deps)).toEqual(NEUTRAL)
      await assertNotAdopted(id, sent)
    })

    it('o mesmo vale se o e-mail vier em outra caixa (Maria@ / maria@) e para 3 tentativas seguidas', async () => {
      const { email, id } = await preExisting('invited-case')
      for (const variant of [email.toUpperCase().replace('@EXAMPLE.COM', '@example.com'), email, email]) {
        const { deps, sent } = makeDeps({ now: () => Date.now() + 10 * 60 * 1000 })
        expect(await handleSignupRequest(request(variant), deps)).toEqual(NEUTRAL)
        await assertNotAdopted(id, sent)
      }
    })

    it('pendente preexistente NUNCA sofre rollback: nem quando outro request falha no Resend com o mesmo e-mail', async () => {
      const { email, id } = await preExisting('invited-fail')
      const { deps } = makeDeps({
        sendEmail: async () => {
          throw new Error('resend caiu')
        },
      })
      expect(await handleSignupRequest(request(email), deps)).toEqual(NEUTRAL)
      expect((await getUser(id))?.id).toBe(id)
    })

    it('o próprio usuário logado consegue forjar user_metadata.signup_flow, mas isso NÃO cria ownership (app_metadata é server-only)', async () => {
      const email = newEmail('forge')
      const password = randomPassword()
      const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      tracked.add(data.user!.id)
      const client = createAnonClient(env)
      await client.auth.signInWithPassword({ email, password })
      await client.auth.updateUser({ data: { signup_flow: 'public_v1', signup_attempt_nonce: 'forjado' } })

      const user = await getUser(data.user!.id)
      expect(user?.user_metadata?.signup_flow).toBe('public_v1') // o usuário escreve aqui...
      expect(user?.app_metadata?.signup_flow).toBeUndefined() // ...mas nunca em app_metadata
      const { readOwnership } = await import('@/lib/auth/signup-adapters')
      expect(readOwnership(user?.app_metadata).ownedByPublicFlow).toBe(false)
    })
  })

  describe('TESTE 3 — Resend com erro ambíguo/timeout', () => {
    it('timeout → rollback SOMENTE porque o nonce é deste request: conta, profile e consentimentos removidos', async () => {
      const email = newEmail('timeout-owner')
      const { deps } = makeDeps({
        sendEmail: async () => {
          throw new EmailSendError('unavailable', null) // o que o Resend devolve num timeout de rede
        },
      })
      expect((await handleSignupRequest(request(email), deps)).status).toBe(503)
      expect(await authUserId(email)).toBeNull()
      expect((await admin.from('profiles').select('id').eq('email', email)).data).toEqual([])
    })

    it('timeout com ownership ALTERADA no meio (outro ator troca o nonce) → conta PRESERVADA, nada apagado', async () => {
      const email = newEmail('timeout-shared')
      let userId: string | null = null
      const { deps } = makeDeps({
        wrap: (port) => ({
          ...port,
          createPendingUser: async (input) => {
            const result = await port.createPendingUser(input)
            if (result.ok) userId = result.userId
            return result
          },
        }),
        sendEmail: async () => {
          // outro ator assume a conta (simula ownership divergente) antes de o rollback reler
          await admin.auth.admin.updateUserById(userId as unknown as string, { app_metadata: { signup_attempt_nonce: 'nonce-de-outro-request' } })
          throw new EmailSendError('unavailable', null)
        },
      })
      const result = await handleSignupRequest(request(email), deps)
      expect(result.status).toBe(503)
      tracked.add(userId as unknown as string)
      const user = await getUser(userId as unknown as string)
      expect(user?.id).toBe(userId) // NÃO foi apagada
      expect(user?.app_metadata?.signup_attempt_nonce).toBe('nonce-de-outro-request')
    })

    it('timeout com a conta já CONFIRMADA por outra via → conta PRESERVADA', async () => {
      const email = newEmail('timeout-confirmed')
      let userId: string | null = null
      const { deps } = makeDeps({
        wrap: (port) => ({
          ...port,
          createPendingUser: async (input) => {
            const result = await port.createPendingUser(input)
            if (result.ok) userId = result.userId
            return result
          },
        }),
        sendEmail: async () => {
          await admin.auth.admin.updateUserById(userId as unknown as string, { email_confirm: true })
          throw new EmailSendError('unavailable', null)
        },
      })
      expect((await handleSignupRequest(request(email), deps)).status).toBe(503)
      tracked.add(userId as unknown as string)
      expect((await getUser(userId as unknown as string))?.email_confirmed_at).toBeTruthy()
    })
  })

  describe('TESTE 4 — rollback normal do usuário recém-criado pelo próprio request', () => {
    it('falha do Resend: usuário, profile e consentimentos removidos, sem resíduo', async () => {
      const email = newEmail('rollback-email')
      let userId: string | null = null
      const { deps } = makeDeps({
        recordConsents: async (id, consents) => {
          userId = id
          await recordSignupConsents(admin, id, consents)
        },
        sendEmail: async () => {
          throw new EmailSendError('rejected', 422)
        },
      })
      expect((await handleSignupRequest(request(email), deps)).status).toBe(503)

      expect(userId).toBeTruthy()
      expect(await getUser(userId as unknown as string)).toBeNull()
      expect((await admin.from('profiles').select('id').eq('id', userId as unknown as string)).data).toEqual([])
      expect(await consentCount(userId as unknown as string)).toBe(0)
      expect(await authUserId(email)).toBeNull()
    })

    it('falha ao gravar consentimento: usuário e profile removidos, e-mail NUNCA enviado', async () => {
      const email = newEmail('rollback-consent')
      const { deps, sent } = makeDeps({
        recordConsents: async () => {
          throw new Error('falha simulada')
        },
      })
      expect((await handleSignupRequest(request(email), deps)).status).toBe(503)
      expect(sent).toHaveLength(0)
      expect(await authUserId(email)).toBeNull()
      expect((await admin.from('profiles').select('id').eq('email', email)).data).toEqual([])
    })

    it('depois do rollback o MESMO e-mail pode se cadastrar de novo normalmente (nenhum resíduo bloqueia)', async () => {
      const email = newEmail('rollback-retry')
      const failing = makeDeps({
        sendEmail: async () => {
          throw new EmailSendError('unavailable', null)
        },
      })
      expect((await handleSignupRequest(request(email), failing.deps)).status).toBe(503)
      const ok = makeDeps()
      expect(await handleSignupRequest(request(email), ok.deps)).toEqual(NEUTRAL)
      expect(ok.sent).toHaveLength(1)
      const id = (await authUserId(email)) as string
      expect(await consentCount(id)).toBe(3)
    })
  })

  describe('TESTE 5 — reemissão legítima para pendente criado pelo próprio fluxo', () => {
    it('novo link (o anterior morre), mesmo dono/nonce, sem consentimento novo e sem senha do cliente', async () => {
      const email = newEmail('reissue')
      const first = makeDeps()
      expect(await handleSignupRequest(request(email), first.deps)).toEqual(NEUTRAL)
      const id = (await authUserId(email)) as string
      const before = await getUser(id)
      const nonceBefore = before?.app_metadata?.signup_attempt_nonce
      expect(before?.app_metadata?.signup_state).toBe('ready')
      const firstToken = tokenFrom(first.sent[0])
      const consentsBefore = await consentCount(id)

      const second = makeDeps({ now: () => Date.now() + 5 * 60 * 1000 }) // fora do cooldown
      expect(await handleSignupRequest(request(email), second.deps)).toEqual(NEUTRAL)
      expect(second.sent).toHaveLength(1)
      const secondToken = tokenFrom(second.sent[0])
      expect(secondToken).not.toBe(firstToken)

      // ownership inalterada
      const after = await getUser(id)
      expect(after?.app_metadata?.signup_attempt_nonce).toBe(nonceBefore)
      expect(after?.app_metadata?.signup_flow).toBe('public_v1')
      expect(after?.app_metadata?.signup_state).toBe('ready')
      expect(after?.user_metadata?.name).toBe('Teste B241') // não sobrescrita
      expect(await consentCount(id)).toBe(consentsBefore) // sem consentimento duplicado

      // o link anterior foi invalidado; o novo funciona
      expect(await handleConfirmRequest(confirmRequest(firstToken), confirmDeps(createAnonClient(env)))).toMatchObject({ kind: 'redirect', location: `${ORIGIN}/auth/confirm?error=invalid` })
      const fresh = createAnonClient(env)
      expect(await handleConfirmRequest(confirmRequest(secondToken), confirmDeps(fresh))).toMatchObject({ kind: 'redirect', location: `${ORIGIN}/auth/set-password` })

      // nenhuma senha conhecida pelo cliente foi definida: nada além da senha aleatória do servidor existe
      const attempt = await createAnonClient(env).auth.signInWithPassword({ email, password: 'Cliente@Conhece1' })
      expect(attempt.data.session).toBeNull()
    })

    it('reemissão dentro do cooldown não envia; em provisioning não reemite (coberto no TESTE 1)', async () => {
      const email = newEmail('reissue-cooldown')
      expect(await handleSignupRequest(request(email), makeDeps().deps)).toEqual(NEUTRAL)
      const again = makeDeps()
      expect(await handleSignupRequest(request(email), again.deps)).toEqual(NEUTRAL)
      expect(again.sent).toHaveLength(0)
    })
  })
})

