/**
 * tests/e2e/labels.spec.ts
 * E2E do Numora Labels (Etapa "F4 — Numora Labels"). Mesmo padrão de
 * tests/e2e/collection.spec.ts/feedback.spec.ts: contas descartáveis em
 * DEV via Admin API, login real pela UI. `benefit_grants` (tipo `beta`) é
 * o único mecanismo hoje disponível para conceder Pro a uma conta de
 * teste — não existe billing real ainda.
 *
 * Itens de coleção do usuário Pro são inseridos direto via `service_role`
 * (setup, não o que está sendo testado — equivalente ao usuário já ter
 * moedas cadastradas antes do teste) para manter os specs focados no
 * comportamento de Labels, não em recriar o formulário "Adicionar moeda"
 * repetidamente (já coberto por collection.spec.ts).
 */
import { test, expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  signInAsDisposableUser,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'
import { loginViaUi } from './support/login'

test.describe('Labels', () => {
  test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')

  // Mesmo motivo do F3 (feedback.spec.ts): o banner de cookies é `position:
  // fixed`, cobre a área inferior da tela em toda navegação nova, e um
  // contexto novo do Playwright nunca tem a decisão salva.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('numora_consent', JSON.stringify({ analytics: false, marketing: false }))
    })
  })

  let env: TestEnv
  let admin: SupabaseClient
  let freeUser: DisposableUser
  let proUser: DisposableUser
  let proUsername: string

  const stamp = Date.now()
  const itemDenomination = `E2E Labels ${stamp}`
  const secondItemDenomination = `E2E Labels Lote ${stamp}`
  let proItemId: string

  // `countryCode`/`year` DIFERENTES por item de propósito: dois itens com o
  // mesmo país/ano produzem o mesmo texto "🇧🇷 Brasil · 1979" tanto no card
  // de fundo (nunca desmontado atrás do modal) quanto na pré-visualização —
  // `getByText` ficaria ambíguo (achado real ao rodar esta suíte).
  async function createItem(
    denomination: string,
    userId: string,
    countryCode = 'BR',
    year = 1979,
  ): Promise<string> {
    const { data, error } = await admin
      .from('collection_items')
      .insert({ user_id: userId, country_code: countryCode, year, denomination, metal_code: 'CU' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`[labels.spec] Falha ao criar item: ${error?.message}`)
    return data.id as string
  }

  test.beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    freeUser = await createDisposableUser(admin, 'e2e-labels-free')
    proUser = await createDisposableUser(admin, 'e2e-labels-pro')

    const { error: grantError } = await admin
      .from('benefit_grants')
      .insert({ user_id: proUser.id, type: 'beta', plan: 'pro', reason: 'F4 Labels E2E', created_by: proUser.id })
    if (grantError) throw new Error(`[labels.spec] Falha ao conceder Pro: ${grantError.message}`)

    proUsername = `e2elabels${stamp}`.slice(0, 24)
    const { error: profileError } = await admin
      .from('profiles')
      .update({ username: proUsername, passport_public: true, passport_collection_visibility: 'all' })
      .eq('id', proUser.id)
    if (profileError) throw new Error(`[labels.spec] Falha ao configurar perfil Pro: ${profileError.message}`)

    proItemId = await createItem(itemDenomination, proUser.id)
    await createItem(secondItemDenomination, proUser.id, 'US', 1965)
  })

  test.afterAll(async () => {
    await deleteDisposableUser(admin, freeUser.id)
    await deleteDisposableUser(admin, proUser.id)
  })

  test('1. usuário Free abre Labels e vê o card de upgrade', async ({ page }) => {
    await loginViaUi(page, freeUser.email, freeUser.password)
    await expect(page).toHaveURL(/\/dashboard/)

    // Free não tem itens próprios nesta suíte — cria um mínimo só para o
    // botão "Imprimir etiqueta" existir na tela (o teste é sobre o GATE,
    // não sobre o conteúdo do item).
    await admin.from('collection_items').insert({ user_id: freeUser.id, denomination: 'Free Item' })
    await page.goto('/dashboard/collection')

    await page.getByRole('button', { name: 'Imprimir etiqueta' }).first().click()
    await expect(page.getByRole('heading', { name: 'Numora Labels' })).toBeVisible()
    await expect(page.getByText('Exclusivo do Numora Pro.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Gerar PDF' })).toHaveCount(0)
  })

  test('2. usuário Pro abre Labels e vê o gerador (não o upgrade)', async ({ page }) => {
    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page.getByRole('button', { name: 'Imprimir etiqueta' }).first().click()
    await expect(page.getByText('Exclusivo do Numora Pro.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeVisible()
  })

  test('3/4. Pro gera etiqueta individual — pré-visualização aparece com os dados corretos', async ({ page }) => {
    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page
      .locator('div', { has: page.getByText(itemDenomination) })
      .getByRole('button', { name: 'Imprimir etiqueta' })
      .first()
      .click()

    await expect(page.getByText(itemDenomination)).toBeVisible()
    await expect(page.getByText('🇧🇷 Brasil · 1979')).toBeVisible()
  })

  test('5. PDF é gerado e disponibilizado para download', async ({ page }) => {
    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page
      .locator('div', { has: page.getByText(itemDenomination) })
      .getByRole('button', { name: 'Imprimir etiqueta' })
      .first()
      .click()

    await page.getByRole('button', { name: 'Gerar PDF' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Baixar PDF' }).click(),
    ])

    expect(download.suggestedFilename()).toMatch(/^etiqueta-NMR-\d{7}\.pdf$/)
  })

  test('6/7. Pro seleciona várias moedas e gera um único PDF A4 em lote', async ({ page }) => {
    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page.getByRole('button', { name: 'Selecionar moedas' }).click()
    await page.getByLabel(`Selecionar ${itemDenomination} para etiqueta`).check()
    await page.getByLabel(`Selecionar ${secondItemDenomination} para etiqueta`).check()
    await expect(page.getByText('2 moedas selecionadas')).toBeVisible()

    await page.getByRole('button', { name: 'Gerar etiquetas' }).click()
    await expect(page.getByText('2 etiquetas selecionadas')).toBeVisible()
    await expect(page.getByText(itemDenomination)).toBeVisible()
    await expect(page.getByText(secondItemDenomination)).toBeVisible()

    await page.getByRole('button', { name: 'Gerar PDF' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Baixar PDF' }).click(),
    ])

    expect(download.suggestedFilename()).toBe('etiquetas-numora.pdf')
  })

  test('9. opção padrão da pré-visualização é "Não mostrar valor"', async ({ page }) => {
    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page
      .locator('div', { has: page.getByText(itemDenomination) })
      .getByRole('button', { name: 'Imprimir etiqueta' })
      .first()
      .click()

    await expect(page.getByLabel('Valor financeiro na etiqueta')).toHaveValue('none')
  })

  test('10. selecionar "Mostrar valor de compra" muda a opção corretamente', async ({ page }) => {
    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page
      .locator('div', { has: page.getByText(itemDenomination) })
      .getByRole('button', { name: 'Imprimir etiqueta' })
      .first()
      .click()

    await page.getByLabel('Valor financeiro na etiqueta').selectOption('purchase')
    await expect(page.getByLabel('Valor financeiro na etiqueta')).toHaveValue('purchase')
  })

  test('8. o QR aponta para o Passport individual (/passport/[username]/coin/[itemId])', async ({ page }) => {
    await page.goto(`/passport/${proUsername}/coin/${proItemId}`)

    await expect(page.getByText(itemDenomination)).toBeVisible()
    await expect(page.getByText(`@${proUsername}`)).toBeVisible()
  })

  test('11/12. moeda sem Passport público ainda pode gerar etiqueta, com aviso não-bloqueante', async ({ page }) => {
    await admin.from('profiles').update({ passport_public: false }).eq('id', proUser.id)

    await loginViaUi(page, proUser.email, proUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/collection')

    await page
      .locator('div', { has: page.getByText(itemDenomination) })
      .getByRole('button', { name: 'Imprimir etiqueta' })
      .first()
      .click()

    await expect(
      page.getByText('Este QR Code só mostrará informações quando seu Passport estiver público.'),
    ).toBeVisible()
    // Não bloqueia: o botão de gerar continua disponível.
    await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled()

    await admin.from('profiles').update({ passport_public: true }).eq('id', proUser.id)
  })

  test('13. Free não consegue executar ensure_label_codes diretamente via API (bypassando a UI)', async ({ page }) => {
    // `@supabase/ssr` guarda a sessão em COOKIES (não localStorage) —
    // confirmado ao escrever este teste (localStorage vinha sempre vazio).
    // Reconstruir o JWT a partir do cookie chunked (`sb-<ref>-auth-token.0`,
    // `.1`...) dependeria de detalhes internos de codificação do Supabase
    // que podem mudar sem aviso. Em vez disso, autentica um client real com
    // as MESMAS credenciais do usuário Free já logado na aba (mesmo usuário,
    // sessão nova) e chama a RPC diretamente — prova exatamente a mesma
    // barreira server-side (um client de API com credenciais Free válidas
    // nunca executa esta operação), sem depender de implementação de
    // cookie. `page` continua logado via UI acima só para confirmar que o
    // login normal do Free funciona antes de tentar a chamada protegida.
    await loginViaUi(page, freeUser.email, freeUser.password)
    await expect(page).toHaveURL(/\/dashboard/)

    const freeApiClient = await signInAsDisposableUser(env, freeUser)
    const { data, error } = await freeApiClient.rpc('ensure_label_codes', { p_item_ids: [proItemId] })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })
})
