/**
 * tests/integration/signup-server-flow.test.ts — Etapa "B2.4 — Signup
 * server-controlled" contra o Supabase DEV real (nunca Production — ver
 * tests/support/dev-env.ts). Exercita o handler REAL de cadastro e de
 * confirmação com as portas REAIS da Admin API/`legal_consents`/`verifyOtp`;
 * só o Turnstile e o Resend são simulados (nenhum e-mail sai de verdade e o
 * link capturado nunca é impresso). Usuários descartáveis em @example.com,
 * todos removidos ao final.
 *
 * O GoTrue do DEV está com `disable_signup=true` (B2.3): a criação só
 * acontece pelo servidor, que é exatamente o que este arquivo prova.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { handleConfirmRequest, type ConfirmDeps } from '@/lib/auth/confirm-signup'
import { cleanupPendingSignups } from '@/lib/auth/pending-signup-cleanup'
import { createSignupAdminPort, readOwnership } from '@/lib/auth/signup-adapters'
import { handleSignupRequest, type SignupHandlerDeps } from '@/lib/auth/signup-handler'
import type { OutgoingEmail } from '@/lib/email/resend'
import { recordSignupConsents } from '@/lib/legal/signup-consents'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { createAdminClient, createAnonClient, deleteDisposableUser, getTestEnv, hasTestEnv, type TestEnv } from '../support/dev-env'

const ORIGIN = 'https://app.numora.test'
const ENV = {
  SIGNUP_ENABLED: 'true',
  NEXT_PUBLIC_SITE_URL: ORIGIN,
  RESEND_API_KEY: 're_not_a_real_key',
  RESEND_FROM_EMAIL: 'Numora <no-reply@numora.test>',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key',
  TURNSTILE_SECRET_KEY: 'test-secret',
}

describe.skipIf(!hasTestEnv())('signup server-controlled — DEV real (B2.4)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  const trackedIds = new Set<string>()
  let counter = 0
  const stamp = Date.now()

  const newEmail = (label: string) => `numora.test.b24-${label}.${stamp}.${++counter}@example.com`
  const randomPassword = () => `Np${Math.random().toString(36).slice(2)}Aa1!${Math.random().toString(36).slice(2)}`

  function body(email: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Teste B24',
      email,
      countryCode: 'BR',
      termsAccepted: true,
      privacyAccepted: true,
      age18Confirmed: true,
      marketingOptIn: false,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
      captchaToken: 'turnstile-test-token',
      ...overrides,
    }
  }

  function request(payload: unknown, options: { origin?: string } = {}): Request {
    return new Request(`${ORIGIN}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: options.origin ?? ORIGIN },
      body: JSON.stringify(payload),
    })
  }

  function makeDeps(overrides: Partial<SignupHandlerDeps> = {}) {
    const sent: OutgoingEmail[] = []
    const deps: SignupHandlerDeps = {
      env: ENV,
      admin: createSignupAdminPort(() => admin),
      verifyCaptcha: async () => 'ok',
      recordConsents: (userId, consents) => recordSignupConsents(admin, userId, consents),
      sendEmail: async (email) => {
        sent.push(email)
      },
      ...overrides,
    }
    return { deps, sent }
  }

  async function findUserId(email: string): Promise<string | null> {
    const { data } = await admin.from('profiles').select('id').eq('email', email).limit(1)
    const id = (data?.[0]?.id as string | undefined) ?? null
    if (id) trackedIds.add(id)
    return id
  }

  const tokenFrom = (email: OutgoingEmail): string => {
    const match = email.text.match(/https:\/\/app\.numora\.test\/auth\/confirm\?[^\s]+/)
    if (!match) throw new Error('link de confirmação não encontrado no e-mail capturado')
    return new URL(match[0]).searchParams.get('token_hash') as string
  }

  /** verifyOtp real (anon key, sem persistência) — o mesmo que a rota faz com o client do servidor. */
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

  function confirmRequest(token: string): Request {
    return new Request(`${ORIGIN}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
      body: new URLSearchParams({ token_hash: token, type: 'signup' }).toString(),
    })
  }

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
  })

  afterAll(async () => {
    for (const id of trackedIds) {
      await deleteDisposableUser(admin, id).catch(() => undefined)
    }
  })

  describe('barreiras antes de qualquer criação', () => {
    it('flag ausente/false → 403 e NENHUM usuário criado', async () => {
      const email = newEmail('closed')
      const { deps } = makeDeps({ env: { ...ENV, SIGNUP_ENABLED: 'false' } })
      expect((await handleSignupRequest(request(body(email)), deps)).status).toBe(403)
      expect(await findUserId(email)).toBeNull()
    })

    it('Origin inválida → 403 e nenhum usuário criado', async () => {
      const email = newEmail('origin')
      const { deps, sent } = makeDeps()
      expect((await handleSignupRequest(request(body(email), { origin: 'https://evil.example' }), deps)).status).toBe(403)
      expect(await findUserId(email)).toBeNull()
      expect(sent).toHaveLength(0)
    })

    it('Turnstile rejeitado → 400 neutro, nenhum usuário, nenhum consentimento, nenhum e-mail', async () => {
      const email = newEmail('captcha')
      const { deps, sent } = makeDeps({ verifyCaptcha: async () => 'rejected' })
      const result = await handleSignupRequest(request(body(email)), deps)
      expect(result.status).toBe(400)
      expect(result.body).toMatchObject({ code: 'captcha_failed' })
      expect(await findUserId(email)).toBeNull()
      expect(sent).toHaveLength(0)
    })

    it.each([
      ['país fora do Brasil', { countryCode: 'US' }],
      ['sem termos', { termsAccepted: false }],
      ['sem privacidade', { privacyAccepted: false }],
      ['sem 18+', { age18Confirmed: false }],
      ['versão legal inválida', { termsVersion: '1999-01-01' }],
    ])('%s → 400 e nenhum usuário criado', async (_label, overrides) => {
      const email = newEmail('invalid')
      const { deps, sent } = makeDeps()
      expect((await handleSignupRequest(request(body(email, overrides)), deps)).status).toBe(400)
      expect(await findUserId(email)).toBeNull()
      expect(sent).toHaveLength(0)
    })
  })

  describe('cadastro novo → e-mail → confirmação → senha', () => {
    const email = newEmail('happy')
    let userId: string
    let token: string
    let signedIn: SupabaseClient
    const chosenPassword = randomPassword()

    it('cria a conta PENDENTE pelo servidor: não confirmada, profile BR, marcador do fluxo, 3 consentimentos gravados pelo servidor', async () => {
      const { deps, sent } = makeDeps()
      const result = await handleSignupRequest(request(body(email)), deps)

      expect(result).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
      userId = (await findUserId(email)) as string
      expect(userId).toBeTruthy()

      const { data } = await admin.auth.admin.getUserById(userId)
      expect(data.user?.email_confirmed_at).toBeFalsy()
      // ownership em app_metadata (server-only), nunca em user_metadata
      expect(data.user?.app_metadata?.signup_flow).toBe('public_v1')
      expect(typeof data.user?.app_metadata?.signup_attempt_nonce).toBe('string')
      expect(data.user?.app_metadata?.signup_state).toBe('ready') // concluído: e-mail enviado
      expect(data.user?.user_metadata?.signup_flow).toBeUndefined()
      expect(data.user?.user_metadata?.signup_attempt_nonce).toBeUndefined()

      const { data: profile } = await admin.from('profiles').select('name, country_code').eq('id', userId).single()
      expect(profile).toEqual({ name: 'Teste B24', country_code: 'BR' })

      const { data: consents } = await admin.from('legal_consents').select('document_type, document_version, source').eq('user_id', userId).order('document_type')
      expect(consents).toEqual([
        { document_type: 'age_18', document_version: AGE_CONFIRMATION_VERSION, source: 'signup' },
        { document_type: 'privacy', document_version: PRIVACY_VERSION, source: 'signup' },
        { document_type: 'terms', document_version: TERMS_VERSION, source: 'signup' },
      ])

      expect(sent).toHaveLength(1)
      expect(sent[0].to).toBe(email)
      token = tokenFrom(sent[0])
      expect(token.length).toBeGreaterThan(8)
    })

    it('ninguém conhece a senha da conta pendente: login com qualquer senha falha e a conta ainda não entra', async () => {
      const client = createAnonClient(env)
      const attempt = await client.auth.signInWithPassword({ email, password: chosenPassword })
      expect(attempt.data.session).toBeNull()
      expect(attempt.error).not.toBeNull()
    })

    it('o GoTrue público continua fechado para signup direto (signup_disabled) — nenhum caminho de criação pelo navegador', async (context) => {
      // Só é significativo com `disable_signup=true` no DEV (configuração externa, provada no B2.3).
      const settings = (await (await fetch(env.url + '/auth/v1/settings', { headers: { apikey: env.anonKey } })).json()) as { disable_signup?: boolean }
      if (!settings.disable_signup) context.skip()
      const client = createAnonClient(env)
      const direct = await client.auth.signUp({ email: newEmail('direct'), password: randomPassword() })
      expect(direct.data.user).toBeNull()
      expect(direct.error?.code).toBe('signup_disabled')
    })

    it('confirmar por POST: verifyOtp funciona, cria sessão e redireciona (303) para /auth/set-password', async () => {
      signedIn = createAnonClient(env)
      const result = await handleConfirmRequest(confirmRequest(token), confirmDeps(signedIn))
      expect(result).toEqual({ kind: 'redirect', location: `${ORIGIN}/auth/set-password`, status: 303 })

      const { data } = await admin.auth.admin.getUserById(userId)
      expect(data.user?.email_confirmed_at).toBeTruthy()
      const session = await signedIn.auth.getSession()
      expect(session.data.session?.user.id).toBe(userId)
    })

    it('o token é de uso único: segundo uso → redirect neutro de link inválido', async () => {
      const result = await handleConfirmRequest(confirmRequest(token), confirmDeps(createAnonClient(env)))
      expect(result).toEqual({ kind: 'redirect', location: `${ORIGIN}/auth/confirm?error=invalid`, status: 303 })
    })

    it('senha DEPOIS da confirmação: updateUser com a sessão funciona e o login com a senha escolhida funciona', async () => {
      const update = await signedIn.auth.updateUser({ password: chosenPassword })
      expect(update.error).toBeNull()

      const login = await createAnonClient(env).auth.signInWithPassword({ email, password: chosenPassword })
      expect(login.error).toBeNull()
      expect(login.data.session?.user.id).toBe(userId)
    })

    it('e-mail já CONFIRMADO: nova tentativa → resposta idêntica, sem e-mail, sem novo consentimento, senha inalterada', async () => {
      const { deps, sent } = makeDeps()
      const result = await handleSignupRequest(request(body(email, { name: 'Invasor', marketingOptIn: true })), deps)

      expect(result).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
      expect(sent).toHaveLength(0)
      const { data: consents } = await admin.from('legal_consents').select('id').eq('user_id', userId)
      expect((consents ?? []).length).toBe(3)
      const { data: profile } = await admin.from('profiles').select('name').eq('id', userId).single()
      expect(profile?.name).toBe('Teste B24')
      const login = await createAnonClient(env).auth.signInWithPassword({ email, password: chosenPassword })
      expect(login.error).toBeNull()
    })
  })

  describe('marketing opcional e separado', () => {
    it('sem opt-in: 3 linhas (nenhum marketing_email); com opt-in: 4 linhas', async () => {
      const a = newEmail('mkt-off')
      const b = newEmail('mkt-on')
      await handleSignupRequest(request(body(a, { marketingOptIn: false })), makeDeps().deps)
      await handleSignupRequest(request(body(b, { marketingOptIn: true })), makeDeps().deps)
      const idA = (await findUserId(a)) as string
      const idB = (await findUserId(b)) as string

      const typesOf = async (id: string) =>
        ((await admin.from('legal_consents').select('document_type').eq('user_id', id)).data ?? []).map((r) => r.document_type as string).sort()
      expect(await typesOf(idA)).toEqual(['age_18', 'privacy', 'terms'])
      expect(await typesOf(idB)).toEqual(['age_18', 'marketing_email', 'privacy', 'terms'])
    })
  })

  describe('e-mail PENDENTE — reemissão sem takeover', () => {
    it('dentro do cooldown não reenvia; depois do cooldown emite link NOVO (o antigo morre), sem duplicar consentimentos', async () => {
      const email = newEmail('pending')
      const first = makeDeps()
      await handleSignupRequest(request(body(email)), first.deps)
      const userId = (await findUserId(email)) as string
      const firstToken = tokenFrom(first.sent[0])

      const cooldown = makeDeps()
      expect(await handleSignupRequest(request(body(email)), cooldown.deps)).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
      expect(cooldown.sent).toHaveLength(0)

      const later = makeDeps({ now: () => Date.now() + 5 * 60 * 1000 })
      await handleSignupRequest(request(body(email, { name: 'Outro Nome' })), later.deps)
      expect(later.sent).toHaveLength(1)
      const secondToken = tokenFrom(later.sent[0])
      expect(secondToken).not.toBe(firstToken)

      const old = await handleConfirmRequest(confirmRequest(firstToken), confirmDeps(createAnonClient(env)))
      expect(old).toMatchObject({ kind: 'redirect', location: `${ORIGIN}/auth/confirm?error=invalid` })

      const { data: consents } = await admin.from('legal_consents').select('id').eq('user_id', userId)
      expect((consents ?? []).length).toBe(3)
      const { data: profile } = await admin.from('profiles').select('name').eq('id', userId).single()
      expect(profile?.name).toBe('Teste B24') // o nome digitado por quem reenviou nunca substitui o original

      const fresh = await handleConfirmRequest(confirmRequest(secondToken), confirmDeps(createAnonClient(env)))
      expect(fresh).toMatchObject({ kind: 'redirect', location: `${ORIGIN}/auth/set-password` })
    })

    it('pendente de OUTRA origem (criado pelo admin, sem marcador) nunca é tocado nem recebe e-mail', async () => {
      const email = newEmail('invited')
      const created = await admin.auth.admin.createUser({ email, password: randomPassword(), email_confirm: false, user_metadata: { name: 'Convidado' } })
      const id = created.data.user!.id
      trackedIds.add(id)

      const { deps, sent } = makeDeps({ now: () => Date.now() + 5 * 60 * 1000 })
      expect(await handleSignupRequest(request(body(email)), deps)).toEqual({ status: 200, body: { ok: true, needsEmailConfirmation: true } })
      expect(sent).toHaveLength(0)

      const { data } = await admin.auth.admin.getUserById(id)
      expect(data.user?.user_metadata?.signup_flow).toBeUndefined()
      expect(data.user?.app_metadata?.signup_flow).toBeUndefined()
      expect(data.user?.app_metadata?.signup_attempt_nonce).toBeUndefined()
      expect(data.user?.user_metadata?.name).toBe('Convidado')
      const { data: consents } = await admin.from('legal_consents').select('id').eq('user_id', id)
      expect(consents).toEqual([])
    })
  })

  describe('rollback contra o banco real', () => {
    it('consentimento falha → 503, e-mail nunca enviado, usuário e profile REMOVIDOS', async () => {
      const email = newEmail('rollback-consent')
      const { deps, sent } = makeDeps({
        recordConsents: async () => {
          throw new Error('falha simulada')
        },
      })
      const result = await handleSignupRequest(request(body(email)), deps)
      expect(result.status).toBe(503)
      expect(sent).toHaveLength(0)
      expect(await findUserId(email)).toBeNull()
      const { data } = await admin.from('profiles').select('id').eq('email', email)
      expect(data).toEqual([])
    })

    it('e-mail (Resend) falha → 503, usuário, profile e consentimentos REMOVIDOS (nenhum fantasma)', async () => {
      const email = newEmail('rollback-email')
      let createdId: string | null = null
      const { deps } = makeDeps({
        recordConsents: async (userId, consents) => {
          createdId = userId
          await recordSignupConsents(admin, userId, consents)
        },
        sendEmail: async () => {
          throw new Error('resend fora do ar')
        },
      })
      const result = await handleSignupRequest(request(body(email)), deps)
      expect(result.status).toBe(503)
      expect(createdId).toBeTruthy()
      expect(await findUserId(email)).toBeNull()
      const { data: consents } = await admin.from('legal_consents').select('id').eq('user_id', createdId as unknown as string)
      expect(consents).toEqual([])
      const { data: user } = await admin.auth.admin.getUserById(createdId as unknown as string)
      expect(user.user).toBeNull()
    })
  })

  describe('cleanup de pendentes — só o escopo seguro', () => {
    it('lista/exclui SOMENTE o pendente do fluxo público; confirmado, sem marcador, conta de análise e admin ficam intactos; idempotente', async () => {
      // (a) pendente do fluxo público (pelo handler real)
      const emailA = newEmail('clean-a')
      await handleSignupRequest(request(body(emailA)), makeDeps().deps)
      const idA = (await findUserId(emailA)) as string

      // Decoys: cada um viola EXATAMENTE uma condição do escopo seguro.
      const make = async (
        label: string,
        options: { confirm: boolean; appMarker: boolean; nonce: boolean; userMarker?: boolean; consent: boolean },
      ) => {
        const { data } = await admin.auth.admin.createUser({
          email: newEmail(label),
          password: randomPassword(),
          email_confirm: options.confirm,
          user_metadata: options.userMarker ? { signup_flow: 'public_v1', signup_attempt_nonce: 'forjado' } : {},
          app_metadata: options.appMarker ? { signup_flow: 'public_v1', ...(options.nonce ? { signup_attempt_nonce: 'n-decoy' } : {}) } : {},
        })
        const id = data.user!.id
        trackedIds.add(id)
        if (options.consent) await recordSignupConsents(admin, id, [{ documentType: 'terms', documentVersion: TERMS_VERSION }])
        return id
      }
      const full = { confirm: false, appMarker: true, nonce: true, consent: true }
      const idB = await make('clean-b', { ...full, appMarker: false, consent: false }) // (b) pendente sem ownership (convite/admin)
      const idC = await make('clean-c', { ...full, confirm: true }) // (c) confirmado, com tudo
      const idD = await make('clean-d', full) // (d) tudo, mas será Conta de Análise
      const idE = await make('clean-e', full) // (e) tudo, mas será role admin
      const idF = await make('clean-f', { ...full, consent: false }) // (f) marcador+nonce, SEM a 2ª evidência (legal_consents)
      const idG = await make('clean-g', { ...full, appMarker: false, nonce: false, userMarker: true }) // (g) marcador FORJADO só em user_metadata
      const idH = await make('clean-h', { ...full, nonce: false }) // (h) marcador em app_metadata, sem nonce
      const idI = await make('clean-i', { ...full, appMarker: false, consent: true }) // (i) consentimento signup sem marcador
      await admin.from('internal_test_accounts').insert({ user_id: idD, created_by: idD })
      await admin.from('profiles').update({ role: 'admin' }).eq('id', idE)
      const decoys = [idB, idC, idD, idE, idF, idG, idH, idI]

      // corte no futuro para que os usuários recém-criados contem como "antigos" nesta prova
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const { data: listed, error } = await admin.rpc('list_stale_pending_public_signups', { p_cutoff: future, p_limit: 500 })
      expect(error).toBeNull()
      const listedIds = ((listed ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)

      expect(listedIds).toContain(idA)
      for (const excluded of decoys) expect(listedIds).not.toContain(excluded)

      // execução real da limpeza (relógio +8 dias => corte de 7 dias fica depois da criação)
      const ports = {
        listStale: async (cutoff: string, limit: number) => {
          const { data } = await admin.rpc('list_stale_pending_public_signups', { p_cutoff: cutoff, p_limit: limit })
          return ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)
        },
        getUser: async (id: string) => {
          const { data } = await admin.auth.admin.getUserById(id)
          const user = data.user
          return user
            ? { id: user.id, confirmed: Boolean(user.email_confirmed_at), hasSignedIn: Boolean(user.last_sign_in_at), createdByPublicFlow: readOwnership(user.app_metadata).ownedByPublicFlow }
            : null
        },
        deleteUser: async (id: string) => {
          const { error: deleteError } = await admin.auth.admin.deleteUser(id)
          if (deleteError) throw new Error('falha')
        },
        now: () => Date.now() + 8 * 24 * 60 * 60 * 1000,
      }
      const first = await cleanupPendingSignups(ports)
      expect(first.deleted).toBeGreaterThanOrEqual(1)

      expect((await admin.auth.admin.getUserById(idA)).data.user).toBeNull()
      for (const kept of decoys) expect((await admin.auth.admin.getUserById(kept)).data.user?.id).toBe(kept)
      const { data: consentsA } = await admin.from('legal_consents').select('id').eq('user_id', idA)
      expect(consentsA).toEqual([]) // cascade

      const second = await cleanupPendingSignups(ports)
      for (const kept of decoys) expect((await admin.auth.admin.getUserById(kept)).data.user?.id).toBe(kept)
      expect(second.deleted).toBe(0)

      await admin.from('internal_test_accounts').delete().eq('user_id', idD)
    })

    it('a função só é executável por service_role (anon e authenticated são recusados)', async () => {
      const anon = createAnonClient(env)
      const viaAnon = await anon.rpc('list_stale_pending_public_signups', { p_cutoff: new Date().toISOString() })
      expect(viaAnon.error).not.toBeNull()

      const email = newEmail('rpc-auth')
      const password = randomPassword()
      const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      trackedIds.add(data.user!.id)
      const authed = createAnonClient(env)
      await authed.auth.signInWithPassword({ email, password })
      const viaAuthed = await authed.rpc('list_stale_pending_public_signups', { p_cutoff: new Date().toISOString() })
      expect(viaAuthed.error).not.toBeNull()
    })
  })
})
