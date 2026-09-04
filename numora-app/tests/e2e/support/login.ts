/**
 * tests/e2e/support/login.ts
 * Helper compartilhado pelos specs de E2E — preenche e envia o formulário
 * real de `/login`, nunca um atalho que pule a UI (o ponto do E2E é
 * exercitar o código de produção de verdade).
 */
import type { Page } from '@playwright/test'

export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  // `{ exact: true }`: sem isso, "Senha" também casa (substring,
  // case-insensitive) com o botão "Mostrar senha" ao lado do campo.
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}
