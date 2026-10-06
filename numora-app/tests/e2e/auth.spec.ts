/**
 * tests/e2e/auth.spec.ts
 * E2E 01, E2E 02, E2E 08 (Etapa "F2 — Closed Beta Test Suite"). Roda
 * contra `baseURL` (default `http://localhost:3000`, servidor local
 * apontando para Supabase DEV via `.env.local` — NUNCA Production, ver
 * playwright.config.ts).
 */
import { test, expect } from '@playwright/test'

import { AGE_CONFIRMATION_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, type DisposableUser, type TestEnv } from '../support/dev-env'
import { isLocalBaseURL, resolveE2EBaseURL } from '../support/local-server-guard'
import { loginViaUi } from './support/login'

const baseURL = resolveE2EBaseURL()

test.describe('Auth', () => {
  test.describe('E2E 01/02 — login e proteção de rota', () => {
    test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')

    let env: TestEnv
    let admin: ReturnType<typeof createAdminClient>
    let user: DisposableUser

    test.beforeAll(async () => {
      env = getTestEnv()!
      admin = createAdminClient(env)
      user = await createDisposableUser(admin, 'e2e-login')
    })

    test.afterAll(async () => {
      await deleteDisposableUser(admin, user.id)
    })

    test('E2E 01 — login válido leva ao dashboard', async ({ page }) => {
      await loginViaUi(page, user.email, user.password)
      await expect(page).toHaveURL(/\/dashboard/)
      await expect(page.getByText(/coleç[aã]o/i).first()).toBeVisible()
    })

    test('E2E 02 — /dashboard sem sessão redireciona para /login', async ({ page, context }) => {
      await context.clearCookies()
      await page.goto('/dashboard')
      await expect(page).toHaveURL(/\/login/)
    })
  })

  test.describe('E2E 08 — Closed Beta: /signup é informativo, /login continua disponível', () => {
    // Etapa B2.5.7: com `E2E_SIGNUP_OPEN=true` o servidor de teste roda com o cadastro ABERTO e estes dois
    // testes (que descrevem o estado FECHADO, o de Production) dão lugar a tests/e2e/signup-open.spec.ts.
    const signupOpen = process.env.E2E_SIGNUP_OPEN === 'true'

    test('não existe formulário de cadastro em /signup — só a tela de Beta Fechado', async ({ page }) => {
      test.skip(signupOpen, 'servidor de teste com o cadastro aberto (E2E_SIGNUP_OPEN=true) — ver signup-open.spec.ts')
      await page.goto('/signup')
      await expect(page.getByRole('heading', { name: 'Beta Fechado' })).toBeVisible()
      await expect(page.getByLabel('E-mail')).toHaveCount(0)
      await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Já tenho acesso' })).toBeVisible()
    })

    test('fechado: POST /api/auth/signup responde 403 signup_closed e não cria nada, mesmo com um corpo 100% válido', async ({ request }) => {
      test.skip(signupOpen, 'servidor de teste com o cadastro aberto (E2E_SIGNUP_OPEN=true) — ver signup-open.spec.ts')
      // Este teste envia um cadastro VÁLIDO: se o servidor estivesse aberto, criaria uma conta de verdade. Só roda
      // contra localhost/127.0.0.1 — nunca contra Production, Preview ou qualquer servidor remoto, mesmo que ele
      // esteja fechado hoje (a proteção não pode depender do estado de um ambiente que pode mudar).
      test.skip(!isLocalBaseURL(baseURL), `baseURL "${baseURL}" não é local (localhost/127.0.0.1): o POST de cadastro válido nunca roda contra um servidor remoto`)
      const response = await request.post('/api/auth/signup', {
        headers: { Origin: baseURL },
        data: {
          name: 'Teste Fechado',
          email: `numora.test.e2e-closed.${Date.now()}@example.com`,
          countryCode: 'BR',
          termsAccepted: true,
          privacyAccepted: true,
          age18Confirmed: true,
          marketingOptIn: false,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
          ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
        },
      })
      expect(response.status()).toBe(403)
      expect(await response.json()).toMatchObject({ ok: false, code: 'signup_closed' })
      expect(response.headers()['cache-control']).toBe('no-store')
    })

    test('/login continua disponível e funcional (campos presentes)', async ({ page }) => {
      await page.goto('/login')
      await expect(page.getByLabel('E-mail')).toBeVisible()
      await expect(page.getByLabel('Senha', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
    })

    test('landing não induz cadastro público — CTA fala em Beta Fechado', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText('Beta Fechado').first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Quero participar do Beta' }).first()).toBeVisible()
    })
  })
})
