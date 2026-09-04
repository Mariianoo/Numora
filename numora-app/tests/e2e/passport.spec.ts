/**
 * tests/e2e/passport.spec.ts
 * E2E 05 (F7), E2E 06 (F8), E2E 07 (Passport público) — Etapa "F2 —
 * Closed Beta Test Suite". `mode: 'serial'` com uma única `page`
 * compartilhada entre os 3 testes (criada em `beforeAll`, fechada em
 * `afterAll`): os cenários são inerentemente sequenciais (definir
 * username/ativar Passport → publicar coleção → publicar foto → ver
 * Passport público), e repetir login/setup em cada `test()` só infla o
 * arquivo sem cobrir nada novo.
 */
import { test, expect, type Page, type Browser } from '@playwright/test'
import path from 'node:path'

import { cleanupUserStorage, createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, type DisposableUser, type TestEnv } from '../support/dev-env'
import { loginViaUi } from './support/login'

const TEST_IMAGE = path.resolve(__dirname, '../fixtures/test-coin-photo.png')

test.describe.configure({ mode: 'serial' })

test.describe('Passport', () => {
  test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')

  let env: TestEnv
  let admin: ReturnType<typeof createAdminClient>
  let user: DisposableUser
  let username: string
  let page: Page

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'e2e-passport')
    // `validateUsernameFormat` limita a 20 caracteres — timestamp truncado
    // aos últimos 8 dígitos mantém unicidade suficiente para um teste
    // descartável sem estourar o limite.
    username = `e2epp${Date.now().toString().slice(-8)}`

    const context = await browser.newContext()
    page = await context.newPage()
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test.afterAll(async () => {
    await page.context().close()
    // Este spec faz upload real de foto (original + derivada pública após
    // F8) — nenhum dos dois buckets é limpo pelo cascade do Postgres.
    await cleanupUserStorage(admin, user.id)
    await deleteDisposableUser(admin, user.id)
  })

  test('setup: define username e ativa o Passport público', async () => {
    await page.goto('/dashboard/profile')
    // `/dashboard/profile` busca perfil+plano+stats+países+role em paralelo
    // no mount (`Promise.all`); interagir antes disso resolver corrompeu o
    // valor digitado (achado real desta etapa, reproduzido de forma
    // consistente) — esperar a rede quietar evita a corrida.
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Nome de usuário').fill(username)
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('Perfil atualizado com sucesso.')).toBeVisible()

    await page.getByRole('switch', { name: 'Ativar Passport público' }).click()
    await expect(page.getByText('Ativo')).toBeVisible()
  })

  test('cria uma moeda com foto de frente (base para F8)', async () => {
    await page.goto('/dashboard/collection')
    await page.getByRole('button', { name: /adicionar (moeda|primeira moeda)/i }).first().click()

    await page.getByLabel('País', { exact: true }).selectOption('BR')
    await page.getByLabel('Denominação').fill('E2E Moeda Passport')
    await page.getByLabel('Metal', { exact: true }).selectOption('AG')
    await page.getByLabel('Percentual (%)').fill('100')

    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText('Moeda adicionada com sucesso.')).toBeVisible()

    await page.getByRole('button', { name: /Adicionar foto — E2E Moeda Passport/ }).click()
    await expect(page.getByText('Fotos do Exemplar')).toBeVisible()

    // 3 inputs ocultos (Frente/Verso/Borda), nessa ordem no DOM — o
    // primeiro é sempre "Frente" (ver components/ui/CoinImageSlot).
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE)

    // O editor de imagem (crop/zoom/posicionamento) abre em seguida.
    await expect(page.getByRole('button', { name: 'Usar esta foto' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Usar esta foto' }).click()
    await expect(page.getByRole('dialog', { name: 'Exemplar #1 — Frente' })).toHaveCount(0)

    // ACHADO DESTA ETAPA: fechar "Fotos do Exemplar" logo após o dialog de
    // crop sumir corre com o upload/gravação em `coin_images`, ainda em
    // andamento — fechar cedo demais cancela a escrita antes dela
    // completar (reproduzido de forma consistente). Esperar o slot
    // "Frente" mostrar o botão "Remover" (só existe no estado com foto já
    // salva) é o sinal real de que a gravação terminou.
    const photosDialog = page.getByRole('dialog', { name: 'Fotos do Exemplar' })
    await expect(photosDialog.getByRole('button', { name: 'Remover' }).first()).toBeVisible({ timeout: 10_000 })
    await photosDialog.getByRole('button', { name: 'Fechar' }).click()
  })

  test('E2E 05 — F7: publicar toda a coleção exige confirmação', async () => {
    await page.goto('/dashboard/profile')
    await page.waitForLoadState('networkidle')
    const visibilitySelect = page.getByLabel('Moedas visíveis no Passport')

    await visibilitySelect.selectOption('all')
    await expect(page.getByRole('heading', { name: 'Publicar toda a coleção?' })).toBeVisible()

    // Cancelar não muda o estado salvo.
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('heading', { name: 'Publicar toda a coleção?' })).toHaveCount(0)
    await expect(visibilitySelect).toHaveValue('none')

    // Confirmar muda o estado.
    await visibilitySelect.selectOption('all')
    await page.getByRole('button', { name: 'Publicar coleção' }).click()
    await expect(page.getByRole('heading', { name: 'Publicar toda a coleção?' })).toHaveCount(0)
    await expect(visibilitySelect).toHaveValue('all')
  })

  test('E2E 06 — F8: publicar foto exige confirmação que identifica a foto frontal do exemplar principal', async () => {
    await page.goto('/dashboard/collection')
    await page.getByRole('button', { name: /Publicar foto no Passport/ }).first().click()

    await expect(page.getByRole('heading', { name: 'Publicar foto no Passport?' })).toBeVisible()
    await expect(page.getByText(/foto frontal do exemplar principal/i)).toBeVisible()

    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('heading', { name: 'Publicar foto no Passport?' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Publicar foto no Passport/ }).first()).toBeVisible()

    await page.getByRole('button', { name: /Publicar foto no Passport/ }).first().click()
    await page.getByRole('button', { name: 'Publicar foto', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Publicar foto no Passport?' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Foto pública no Passport/ }).first()).toBeVisible()
  })

  test('E2E 07 — Passport público acessível sem sessão, com dados públicos e sem dados privados', async ({ browser }) => {
    const anonContext = await browser.newContext()
    const anonPage = await anonContext.newPage()

    await anonPage.goto(`/passport/${username}`)
    await expect(anonPage.getByText('E2E Moeda Passport')).toBeVisible()
    await expect(anonPage.getByText(user.email)).toHaveCount(0)

    const bodyText = await anonPage.locator('body').innerText()
    expect(bodyText.toLowerCase()).not.toContain('preço')
    expect(bodyText.toLowerCase()).not.toContain('custo')

    await anonContext.close()
  })
})
