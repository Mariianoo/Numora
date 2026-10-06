/**
 * tests/e2e/signup-open.spec.ts — Etapa "B2.5.7 (Bloco C)": E2E do signup público ABERTO, sem abrir
 * Production. Roda SOMENTE com `E2E_SIGNUP_OPEN=true` (o playwright.config.ts então sobe o servidor
 * de desenvolvimento local com `SIGNUP_ENABLED=true`, origem canônica local e Resend com chave FALSA)
 * e só contra um `baseURL` local; toda escrita vai para o Supabase DEV (guard de tests/support/dev-env).
 *
 *   $env:E2E_SIGNUP_OPEN="true"; npx playwright test tests/e2e/signup-open.spec.ts      (PowerShell)
 *   E2E_SIGNUP_OPEN=true npx playwright test tests/e2e/signup-open.spec.ts              (bash)
 *
 * O QUE ESTE E2E PROVA (UI real + servidor real + banco DEV real):
 *  - /signup mostra o formulário (e não o Beta Fechado); nada vem pré-marcado; o aceite é validado na UI;
 *  - o SERVIDOR recusa quem pula a UI (aceite ausente, versão antiga, Origin inválida, corpo inválido,
 *    país não-BR) sem criar nada; rate limit por IP devolve 429 + Retry-After no 11º pedido;
 *  - cadastro completo pelo formulário cuja etapa de e-mail FALHA (chave Resend falsa): 503 neutro e
 *    NENHUM usuário fantasma (rollback);
 *  - confirmação → definição de senha → dashboard pela UI real, com a senha descartada invalidada, o
 *    aceite legal persistido para o usuário certo, role "user", plano free, sem subscription/grant;
 *  - link de confirmação reutilizado/malformado, senha fraca ou divergente, conta não confirmada.
 *
 * LIMITAÇÃO CONHECIDA (documentada, NÃO contornada): o projeto não tem NENHUM transporte de e-mail de
 * teste no servidor real (o e-mail só é injetável nos testes de handler/integração). Por isso a ponta
 * "formulário → servidor real cria a conta → e-mail capturado → link" NÃO é E2E de verdade: o servidor
 * real, com chave Resend falsa, desfaz o cadastro. Para o trecho pós-e-mail o teste provisiona a conta
 * pendente pela Admin API (as MESMAS chamadas do adaptador: createUser com app_metadata do fluxo
 * público + generateLink + aceite pelo próprio recordSignupConsents) e entra pelo link na UI real. O
 * que falta para o E2E completo é um transporte de e-mail de teste (ex.: chave Resend de teste com
 * leitura da caixa, ou um coletor local atrás de uma variável que NUNCA exista em Production) — não
 * foi inventado aqui por ser superfície nova em código de produção. A cadeia handler → e-mail
 * capturado por injeção → confirmação → senha → login segue provada em
 * tests/integration/signup-server-flow.test.ts.
 *
 * Fora daqui (cobertos por testes de unidade/integração, que usam o handler real): CAPTCHA obrigatório
 * ausente/inválido (captcha-required-policy.test.ts, signup-server-flow.test.ts) — exigiria outro
 * servidor com chaves Turnstile.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type APIResponse } from '@playwright/test'

import { normalizeEmailForRateLimit, rateLimitBucketKey } from '@/lib/auth/signup-rate-limit'
import { buildSignupConsents, recordSignupConsents } from '@/lib/legal/signup-consents'
import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { createClockSkewRetryingFetch } from '../support/clock-skew-fetch'
import { createAdminClient, createAnonClient, deleteDisposableUser, getTestEnv, hasTestEnv, type TestEnv } from '../support/dev-env'
import { resolveE2EBaseURL } from '../support/local-server-guard'
import { assertServerUsesDevSupabase } from './support/local-server'
import { loginViaUi } from './support/login'

const openMode = process.env.E2E_SIGNUP_OPEN === 'true'
const baseURL = resolveE2EBaseURL()
const UNKNOWN_IP_BUCKET = rateLimitBucketKey('ip', 'unknown')

test.describe('Signup público aberto — E2E (B2.5.7)', () => {
  test.skip(!openMode, 'E2E_SIGNUP_OPEN != true — servidor de teste com o cadastro FECHADO (estado de Production)')
  test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')
  test.describe.configure({ mode: 'serial' })

  let env: TestEnv
  let admin: ReturnType<typeof createAdminClient>
  const userIds = new Set<string>()
  const bucketKeys = new Set<string>([UNKNOWN_IP_BUCKET])
  let counter = 0

  const newEmail = (label: string) => {
    const email = `numora.test.e2e-signup-${label}.${Date.now()}.${++counter}@example.com`
    bucketKeys.add(rateLimitBucketKey('email', normalizeEmailForRateLimit(email)))
    return email
  }
  const strongPassword = () => `E2e!${randomUUID().slice(0, 8)}Aa1x`
  const resetBuckets = async () => {
    await admin.from('signup_rate_limits').delete().in('bucket_key', [...bucketKeys])
  }
  const userIdByEmail = async (email: string): Promise<string | null> => {
    const { data } = await admin.rpc('get_auth_user_id_by_email', { p_email: email })
    return typeof data === 'string' && data ? data : null
  }

  function signupBody(email: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Teste E2E Signup',
      email,
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

  /** Conta pendente do fluxo público, como o servidor a deixa depois do e-mail: mesmas chamadas do adaptador. */
  async function provisionPendingAccount(label: string, options: { withConsents?: boolean; marketing?: boolean } = {}) {
    const email = newEmail(label)
    const password = strongPassword() // desconhecida de qualquer pessoa no fluxo real; aqui só para provar que nem ela entra sem confirmar
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { name: 'Teste E2E Signup', country_code: 'BR' },
      app_metadata: { signup_flow: 'public_v1', signup_attempt_nonce: `e2e-${randomUUID()}`, signup_state: 'ready' },
    })
    if (error || !data.user) throw new Error(`falha ao provisionar a conta pendente de teste: ${error?.message}`)
    userIds.add(data.user.id)
    if (options.withConsents !== false) await recordSignupConsents(admin, data.user.id, buildSignupConsents(options.marketing === true))
    return { id: data.user.id, email, password }
  }

  async function confirmationToken(email: string, password: string): Promise<string> {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'signup', email, password, options: { redirectTo: `${baseURL}/auth/confirm` } })
    const token = data?.properties?.hashed_token
    if (error || !token) throw new Error(`falha ao gerar o link de confirmação de teste: ${error?.message}`)
    return token
  }

  const expectNeutral = async (response: APIResponse, email: string) => {
    expect(response.headers()['cache-control']).toBe('no-store')
    const text = await response.text()
    expect(text).not.toContain(email) // nunca ecoa o e-mail digitado
    expect(JSON.parse(text)).toMatchObject({ ok: false })
  }

  test.beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env, { fetch: createClockSkewRetryingFetch() })
    // ANTES de qualquer teste com efeito: o servidor sob teste é LOCAL e aponta para o Supabase DEV. Não basta
    // `SUPABASE_TEST_*` (variáveis do processo de teste): a prova olha o que o SERVIDOR realmente usa — ver
    // tests/e2e/support/local-server.ts. Falha fechado (Production, outro projeto ou sem prova → nada roda).
    await assertServerUsesDevSupabase({ baseURL, admin, onCanaryUser: (id) => userIds.add(id) })
  })

  test.beforeEach(async () => {
    await resetBuckets() // cada teste começa com o limite do IP "unknown" zerado
  })

  test.afterAll(async () => {
    await resetBuckets()
    for (const id of userIds) await deleteDisposableUser(admin, id).catch(() => undefined)
  })

  test.describe('formulário (UI)', () => {
    test('/signup mostra o formulário de cadastro — não a tela de Beta Fechado — sem senha e sem nada pré-marcado', async ({ page }) => {
      await page.goto('/signup')
      await expect(page.getByRole('button', { name: 'Criar minha conta' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Beta Fechado' })).toHaveCount(0)
      await expect(page.getByLabel('Nome', { exact: true })).toBeVisible()
      await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible()
      await expect(page.getByLabel('País')).toHaveValue('Brasil')
      await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0) // a senha só é definida depois de confirmar o e-mail

      for (const id of ['#signup-terms', '#signup-privacy', '#signup-age', '#signup-marketing']) {
        await expect(page.locator(id)).not.toBeChecked()
      }
      await expect(page.locator('form').getByRole('link', { name: 'Termos de Uso' })).toBeVisible()
      await expect(page.locator('form').getByRole('link', { name: 'Política de Privacidade' })).toBeVisible()
    })

    for (const scenario of [
      { name: 'Terms não aceito', skip: '#signup-terms', message: 'É necessário aceitar os Termos de Uso.' },
      { name: 'Privacy não aceita', skip: '#signup-privacy', message: 'É necessário aceitar a Política de Privacidade.' },
      { name: '18+ não confirmado', skip: '#signup-age', message: 'É necessário confirmar que você tem 18 anos ou mais.' },
    ]) {
      test(`${scenario.name} → erro na tela e NENHUMA requisição ao servidor`, async ({ page }) => {
        const signupCalls: string[] = []
        page.on('request', (request) => {
          if (request.url().includes('/api/auth/signup')) signupCalls.push(request.url())
        })

        await page.goto('/signup')
        await page.getByLabel('Nome', { exact: true }).fill('Teste E2E Signup')
        await page.getByLabel('E-mail', { exact: true }).fill(newEmail('ui-negative'))
        for (const id of ['#signup-terms', '#signup-privacy', '#signup-age']) if (id !== scenario.skip) await page.locator(id).check()
        await page.getByRole('button', { name: 'Criar minha conta' }).click()

        await expect(page.locator('p[role="alert"]')).toHaveText(scenario.message)
        expect(signupCalls).toHaveLength(0)
      })
    }

    test('e-mail inválido → erro na tela e nenhuma requisição', async ({ page }) => {
      let called = false
      page.on('request', (request) => {
        if (request.url().includes('/api/auth/signup')) called = true
      })
      await page.goto('/signup')
      await page.getByLabel('Nome', { exact: true }).fill('Teste E2E Signup')
      await page.getByLabel('E-mail', { exact: true }).fill('isto-nao-e-um-email')
      for (const id of ['#signup-terms', '#signup-privacy', '#signup-age']) await page.locator(id).check()
      await page.getByRole('button', { name: 'Criar minha conta' }).click()
      await expect(page.locator('p[role="alert"]')).toHaveText('Informe um e-mail válido.')
      expect(called).toBe(false)
    })
  })

  test.describe('servidor recusa quem pula a UI (nada é criado)', () => {
    const post = (request: Parameters<Parameters<typeof test>[2]>[0]['request'], data: unknown, headers: Record<string, string> = { Origin: baseURL }) =>
      request.post('/api/auth/signup', { headers, data })

    for (const scenario of [
      { name: 'Terms ausente', overrides: { termsAccepted: false }, code: 'terms_required' },
      { name: 'Privacy ausente', overrides: { privacyAccepted: false }, code: 'privacy_required' },
      { name: '18+ ausente', overrides: { age18Confirmed: false }, code: 'age_confirmation_required' },
      { name: 'versão dos Termos antiga', overrides: { termsVersion: '2020-01-01' }, code: 'documents_outdated' },
      { name: 'versão da Privacidade antiga', overrides: { privacyVersion: '2020-01-01' }, code: 'documents_outdated' },
      { name: 'país fora do Brasil', overrides: { countryCode: 'US' }, code: 'country_invalid' },
    ]) {
      test(`${scenario.name} → 400 ${scenario.code}, sem usuário e sem aceite`, async ({ request }) => {
        const email = newEmail('bypass')
        const response = await post(request, signupBody(email, scenario.overrides))

        expect(response.status()).toBe(400)
        expect(await response.json()).toMatchObject({ ok: false, code: scenario.code })
        await expectNeutral(response, email)
        expect(await userIdByEmail(email)).toBeNull()
      })
    }

    test('Origin inválida ou ausente → 403 forbidden antes de qualquer coisa', async ({ request }) => {
      const email = newEmail('origin')
      for (const headers of [{ Origin: 'https://evil.example' }, {} as Record<string, string>]) {
        const response = await post(request, signupBody(email), headers)
        expect(response.status()).toBe(403)
        expect(await response.json()).toMatchObject({ ok: false, code: 'forbidden' })
        await expectNeutral(response, email)
      }
      expect(await userIdByEmail(email)).toBeNull()
    })

    test('corpo que não é JSON → 400 invalid_body', async ({ request }) => {
      const response = await request.post('/api/auth/signup', { headers: { Origin: baseURL, 'Content-Type': 'application/json' }, data: '{isto não é json' })
      expect(response.status()).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: 'invalid_body' })
    })

    test('campos que fingem aceite (consents, user_metadata, source) não criam nada quando o aceite real está ausente', async ({ request }) => {
      const email = newEmail('forged')
      const response = await post(
        request,
        signupBody(email, { termsAccepted: false, consents: [{ documentType: 'terms', documentVersion: TERMS_VERSION }], user_metadata: { terms_version: TERMS_VERSION }, source: 'admin' }),
      )
      expect(response.status()).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'terms_required' })
      expect(await userIdByEmail(email)).toBeNull()
    })
  })

  test('rate limit: do 11º pedido do mesmo IP em diante → 429 rate_limited com Retry-After, sem eco do e-mail', async ({ request }) => {
    for (let i = 1; i <= 10; i += 1) {
      const response = await request.post('/api/auth/signup', { headers: { Origin: baseURL }, data: signupBody(newEmail('rl'), { termsAccepted: false }) })
      expect(response.status(), `pedido ${i}`).toBe(400)
    }

    const email = newEmail('rl-blocked')
    const blocked = await request.post('/api/auth/signup', { headers: { Origin: baseURL }, data: signupBody(email) })
    expect(blocked.status()).toBe(429)
    expect(await blocked.json()).toMatchObject({ ok: false, code: 'rate_limited' })
    const retryAfter = Number(blocked.headers()['retry-after'])
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    await expectNeutral(blocked, email)
    expect(await userIdByEmail(email)).toBeNull()
  })

  test('cadastro pelo formulário com a etapa de e-mail indisponível → erro neutro na tela e NENHUM usuário fantasma (rollback)', async ({ page }) => {
    const email = newEmail('rollback')
    const responses: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/api/auth/signup')) responses.push(response.status())
    })

    await page.goto('/signup')
    await page.getByLabel('Nome', { exact: true }).fill('Teste E2E Signup')
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    for (const id of ['#signup-terms', '#signup-privacy', '#signup-age']) await page.locator(id).check() // marketing fica de fora: opcional
    await page.getByRole('button', { name: 'Criar minha conta' }).click()

    await expect(page.locator('p[role="alert"]')).toHaveText('O cadastro está temporariamente indisponível. Tente novamente mais tarde.', { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Verifique seu e-mail' })).toHaveCount(0)
    expect(responses).toEqual([503])
    expect(await userIdByEmail(email)).toBeNull()
  })

  test.describe('confirmação do e-mail → senha → dashboard (UI real)', () => {
    test('link válido: confirma, define a senha (política e confirmação), entra no dashboard; sem privilégios indevidos', async ({ page }) => {
      const account = await provisionPendingAccount('journey')
      const token = await confirmationToken(account.email, account.password)

      // 1. /auth/confirm só mostra o botão (GET não consome o token); o POST consome.
      await page.goto(`/auth/confirm?token_hash=${token}&type=signup`)
      await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible()
      await page.getByRole('button', { name: 'Confirmar meu e-mail' }).click()

      // 2. /auth/set-password com sessão: política de senha e confirmação
      await expect(page).toHaveURL(/\/auth\/set-password/)
      await expect(page.getByText('Seu e-mail foi confirmado')).toBeVisible()
      const newPassword = strongPassword()
      const submit = page.getByRole('button', { name: 'Definir senha' })

      await page.getByLabel('Nova senha', { exact: true }).fill('abc')
      await expect(submit).toBeDisabled() // senha fraca nunca é enviada

      await page.getByLabel('Nova senha', { exact: true }).fill(newPassword)
      await page.getByLabel('Confirmar senha', { exact: true }).fill(`${newPassword}-diferente`)
      await submit.click()
      await expect(page.locator('p[role="alert"]')).toHaveText('As senhas não coincidem.')

      await page.getByLabel('Confirmar senha', { exact: true }).fill(newPassword)
      await submit.click()

      // 3. dashboard autenticado
      await expect(page.getByRole('heading', { name: 'Senha definida' })).toBeVisible()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
      await expect(page.getByText(/coleç[aã]o/i).first()).toBeVisible()

      // 4. o usuário está confirmado, o marcador do fluxo público foi preservado
      const { data: fetched } = await admin.auth.admin.getUserById(account.id)
      expect(fetched.user?.email_confirmed_at).toBeTruthy()
      expect(fetched.user?.app_metadata).toMatchObject({ signup_flow: 'public_v1' })

      // 5. a senha descartada não entra mais; a escolhida entra
      const anon = createAnonClient(env)
      expect((await anon.auth.signInWithPassword({ email: account.email, password: account.password })).error).not.toBeNull()
      expect((await anon.auth.signInWithPassword({ email: account.email, password: newPassword })).error).toBeNull()

      // 6. aceite legal persistido para ESTE usuário (3 obrigatórios, sem marketing)
      const { data: consents } = await admin.from('legal_consents').select('user_id, document_type, document_version, source').eq('user_id', account.id)
      expect((consents ?? []).map((row) => row.document_type).sort()).toEqual(['age_18', 'privacy', 'terms'])
      expect(new Set((consents ?? []).map((row) => row.source))).toEqual(new Set(['signup']))
      expect((consents ?? []).find((row) => row.document_type === 'terms')?.document_version).toBe(TERMS_VERSION)

      // 7. sem privilégios indevidos
      const { data: profile } = await admin.from('profiles').select('role, plan_tier, country_code').eq('id', account.id).single()
      expect(profile).toMatchObject({ role: 'user', plan_tier: 'free', country_code: 'BR' })
      for (const table of ['subscriptions', 'billing_customers', 'benefit_grants', 'internal_test_accounts']) {
        const { data: rows, error } = await admin.from(table).select('user_id').eq('user_id', account.id)
        expect(error, table).toBeNull()
        expect(rows ?? [], table).toHaveLength(0)
      }
      const { data: plan } = await admin.rpc('get_effective_plan', { p_user_id: account.id }).maybeSingle()
      expect((plan as { plan_slug: string } | null)?.plan_slug).toBe('free')
      await page.goto('/admin')
      await expect(page).not.toHaveURL(/\/admin/) // sem role administrativa → redirect seguro

      // 8. o link é de uso único: reutilizar mostra a mensagem neutra
      await page.context().clearCookies()
      await page.goto(`/auth/confirm?token_hash=${token}&type=signup`)
      await page.getByRole('button', { name: 'Confirmar meu e-mail' }).click()
      await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible()
    })

    test('links malformados, ausentes ou inexistentes → mensagem neutra, nunca um erro técnico', async ({ page }) => {
      for (const url of ['/auth/confirm', '/auth/confirm?type=signup', '/auth/confirm?token_hash=zzz&type=signup', `/auth/confirm?token_hash=${'a'.repeat(32)}&type=magiclink`]) {
        await page.goto(url)
        await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' }), url).toBeVisible()
      }

      // formato válido, token inexistente: o botão aparece, o POST falha e volta à mensagem neutra
      await page.goto(`/auth/confirm?token_hash=${'a'.repeat(64)}&type=signup`)
      await page.getByRole('button', { name: 'Confirmar meu e-mail' }).click()
      await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible()
    })

    test('/auth/set-password sem sessão não permite definir senha', async ({ page }) => {
      await page.context().clearCookies()
      await page.goto('/auth/set-password')
      await expect(page.getByRole('heading', { name: 'Sessão não encontrada' })).toBeVisible()
      await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0)
    })

    test('conta NÃO confirmada não entra, nem com a senha correta, e o dashboard continua protegido', async ({ page }) => {
      const account = await provisionPendingAccount('unconfirmed')

      await loginViaUi(page, account.email, account.password)
      await expect(page.locator('p[role="alert"]')).toHaveText('Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.')
      await expect(page).toHaveURL(/\/login/)

      await page.goto('/dashboard')
      await expect(page).toHaveURL(/\/login/)
    })
  })
})
