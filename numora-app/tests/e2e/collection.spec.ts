/**
 * tests/e2e/collection.spec.ts
 * E2E 03, E2E 04 (Etapa "F2 — Closed Beta Test Suite"). Conta descartável
 * em DEV, criada via Admin API (nunca signup público) — removida ao final
 * mesmo se algum teste falhar (`afterAll`).
 */
import { test, expect } from '@playwright/test'

import { createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, type DisposableUser, type TestEnv } from '../support/dev-env'
import { loginViaUi } from './support/login'

test.describe('Collection', () => {
  test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')

  let env: TestEnv
  let admin: ReturnType<typeof createAdminClient>
  let user: DisposableUser

  test.beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'e2e-collection')
  })

  test.afterAll(async () => {
    await deleteDisposableUser(admin, user.id)
  })

  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('E2E 03 — criar moeda válida e confirmar que aparece na coleção', async ({ page }) => {
    await page.goto('/dashboard/collection')
    await page.getByRole('button', { name: /adicionar moeda/i }).first().click()

    await page.getByLabel('País', { exact: true }).selectOption('BR')
    await page.getByLabel('Ano', { exact: true }).fill('1970')
    await page.getByLabel('Denominação').fill('E2E Moeda Válida')
    await page.getByLabel('Metal', { exact: true }).selectOption('CU')

    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText('Moeda adicionada com sucesso.')).toBeVisible()
    await expect(page.getByText('E2E Moeda Válida').first()).toBeVisible()
  })

  test('E2E 04 — composição inválida mostra erro e não salva', async ({ page }) => {
    await page.goto('/dashboard/collection')
    await page.getByRole('button', { name: /adicionar moeda/i }).first().click()

    await page.getByLabel('País', { exact: true }).selectOption('BR')
    await page.getByLabel('Ano', { exact: true }).fill('1971')
    await page.getByLabel('Denominação').fill('E2E Composição Inválida')

    // "Material simples" com percentual != 100 — regra da RPC
    // (`set_collection_item_composition`) validada no client antes do
    // envio. O feedback de percentual só renderiza depois de um metal
    // selecionado (`CoinCompositionEditor.tsx` — `state.simpleMetal !== ''`),
    // por isso o metal é escolhido primeiro.
    await page.getByLabel('Metal', { exact: true }).selectOption('CU')
    await page.getByLabel('Percentual (%)').fill('50')

    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText(/percentual deve ser 100%|percentuais precisam totalizar 100%/i)).toBeVisible()
    // Nunca fecha o modal nem mostra "sucesso" quando a composição é inválida.
    await expect(page.getByText('Moeda adicionada com sucesso.')).toHaveCount(0)
    await expect(page.getByText('E2E Composição Inválida')).toHaveCount(0)
  })
})
