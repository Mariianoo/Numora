/**
 * tests/e2e/auth.spec.ts
 * E2E 01, E2E 02, E2E 08 (Etapa "F2 — Closed Beta Test Suite"). Roda
 * contra `baseURL` (default `http://localhost:3000`, servidor local
 * apontando para Supabase DEV via `.env.local` — NUNCA Production, ver
 * playwright.config.ts).
 */
import { test, expect } from '@playwright/test'

import { createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, type DisposableUser, type TestEnv } from '../support/dev-env'
import { loginViaUi } from './support/login'

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
    test('não existe formulário de cadastro em /signup — só a tela de Beta Fechado', async ({ page }) => {
      await page.goto('/signup')
      await expect(page.getByRole('heading', { name: 'Beta Fechado' })).toBeVisible()
      await expect(page.getByLabel('E-mail')).toHaveCount(0)
      await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Já tenho acesso' })).toBeVisible()
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
