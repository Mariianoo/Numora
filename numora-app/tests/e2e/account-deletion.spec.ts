/**
 * tests/e2e/account-deletion.spec.ts
 * E2E 09 (Etapa "F2 — Closed Beta Test Suite") — exercita o fluxo REAL de
 * produção (`app/api/account/delete/route.ts`, via a UI de
 * "Excluir minha conta"), diferente de `tests/integration/account-deletion.test.ts`
 * (que reproduz a mesma sequência de chamadas Supabase para poder afirmar
 * tabela por tabela). Os dois se complementam — ver comentário daquele
 * arquivo. DESTRUTIVO: só roda contra DEV (guard em tests/support/dev-env.ts).
 */
import { test, expect } from '@playwright/test'

import { createAdminClient, createDisposableUser, getTestEnv, hasTestEnv, type DisposableUser, type TestEnv } from '../support/dev-env'
import { loginViaUi } from './support/login'

test.describe('Account deletion (E2E, destrutivo — DEV apenas)', () => {
  test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')

  let env: TestEnv
  let admin: ReturnType<typeof createAdminClient>
  let user: DisposableUser
  let deleted = false

  test.beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'e2e-deletion')
  })

  // Rede de segurança: só age se o teste falhar ANTES da exclusão real
  // acontecer — depois dela, o usuário já não existe mais.
  test.afterAll(async () => {
    if (!deleted) {
      try {
        await admin.rpc('delete_own_account_data', { p_user_id: user.id })
      } catch {
        // Melhor esforço — ver comentário acima.
      }
      await admin.auth.admin.deleteUser(user.id).catch(() => {})
    }
  })

  test('E2E 09 — exclusão de conta via UI: redireciona, desloga, e a conta não autentica mais', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto('/dashboard/profile')
    await page.getByRole('button', { name: 'Excluir minha conta' }).click()
    await page.getByLabel('Confirmação').fill('EXCLUIR')
    await page.getByRole('button', { name: 'Excluir permanentemente' }).click()

    // A própria rota faz signOut + redirect para a landing ao concluir.
    await expect(page).toHaveURL(/^http:\/\/[^/]+\/?$/, { timeout: 15_000 })
    deleted = true

    // A conta não deve mais autenticar — mesma UI de login, credenciais antigas.
    await page.goto('/login')
    await page.getByLabel('E-mail').fill(user.email)
    await page.getByLabel('Senha', { exact: true }).fill(user.password)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByText(/e-mail ou senha incorretos/i)).toBeVisible()
    await expect(page).not.toHaveURL(/\/dashboard/)
  })
})
