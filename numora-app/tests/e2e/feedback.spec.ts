/**
 * tests/e2e/feedback.spec.ts
 * E2E da Central de Feedback (Etapa "F3 — Numora Feedback"). Mesmo padrão
 * de tests/e2e/collection.spec.ts: contas descartáveis em DEV via Admin
 * API, login real pela UI (`loginViaUi`), nunca um atalho que pule a tela
 * de login. `workers: 1`/`fullyParallel: false` (playwright.config.ts)
 * garante execução sequencial — os testes de admin dependem do feedback
 * criado pelos testes de usuário comum, na ordem em que aparecem no
 * arquivo.
 *
 * IMPORTANTE: `loginViaUi` só envia o formulário, não espera o redirect
 * pós-login terminar (os outros specs sempre fazem
 * `await expect(page).toHaveURL(/\/dashboard/)` logo depois, por isso
 * nunca reparam nisso). Chamar `page.goto()` imediatamente após
 * `loginViaUi` SEM esperar por `/dashboard` primeiro cancela a navegação
 * do próprio login em andamento — a sessão nunca chega a existir e o
 * `goto` seguinte cai de volta em `/login` (achado real desta etapa,
 * reproduzido consistentemente). Por isso todo teste abaixo espera
 * `/\/dashboard/` antes de navegar para outro lugar.
 */
import { test, expect } from '@playwright/test'

import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'
import { loginViaUi } from './support/login'

test.describe('Feedback', () => {
  test.skip(!hasTestEnv(), 'SUPABASE_TEST_* não configurado — ver .env.test.example')

  // O banner de cookies (components/analytics/ConsentBanner.tsx) é
  // `position: fixed; bottom: 0`, sobre TODA a largura da viewport, e só
  // some depois de uma decisão salva em `localStorage['numora_consent']`.
  // Um contexto novo do Playwright nunca tem essa chave, então o banner
  // aparece em toda navegação — e, nesta página, cobre exatamente a área
  // onde os botões de tipo/envio ficam, travando os cliques até o
  // timeout. `addInitScript` grava a mesma chave que "Recusar todos"
  // gravaria (lib/analytics/consent.ts) ANTES de qualquer script da
  // página rodar, sem tocar em nenhum arquivo de produção.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('numora_consent', JSON.stringify({ analytics: false, marketing: false }))
    })
  })

  let env: TestEnv
  let admin: ReturnType<typeof createAdminClient>
  let user: DisposableUser
  let otherUser: DisposableUser
  let adminUser: DisposableUser

  const stamp = Date.now()
  const praiseTitle = `E2E Elogio ${stamp}`
  const suggestionTitle = `E2E Sugestão ${stamp}`
  const problemTitle = `E2E Problema ${stamp}`
  const otherUserTitle = `E2E Feedback de Outro Usuário ${stamp}`
  const internalNoteText = `Nota interna confidencial ${stamp}`

  test.beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'e2e-feedback-user')
    otherUser = await createDisposableUser(admin, 'e2e-feedback-other')
    adminUser = await createDisposableUser(admin, 'e2e-feedback-admin')

    const { error: promoteError } = await admin.from('profiles').update({ role: 'admin' }).eq('id', adminUser.id)
    if (promoteError) {
      throw new Error(`[feedback.spec] Falha ao promover admin: ${promoteError.message}`)
    }

    // Feedback de "outro usuário" criado direto via service_role (setup,
    // não é o que está sendo testado) — usado pelo teste 5 para confirmar
    // que ele nunca aparece na tela do usuário principal.
    const { error: otherFeedbackError } = await admin
      .from('feedbacks')
      .insert({ user_id: otherUser.id, type: 'praise', title: otherUserTitle, message: 'Mensagem de outro usuário' })
    if (otherFeedbackError) {
      throw new Error(`[feedback.spec] Falha ao criar feedback de outro usuário: ${otherFeedbackError.message}`)
    }
  })

  test.afterAll(async () => {
    await deleteDisposableUser(admin, user.id)
    await deleteDisposableUser(admin, otherUser.id)
    await deleteDisposableUser(admin, adminUser.id)
  })

  test('1. usuário abre a página Feedback pela Sidebar', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)

    await page.getByRole('link', { name: 'Feedback' }).click()
    await expect(page).toHaveURL(/\/dashboard\/feedback/)
    await expect(page.getByRole('heading', { name: 'Envie seu feedback' })).toBeVisible()
  })

  test('2. usuário envia um elogio (❤️) com sucesso', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/feedback')

    await page.getByRole('button', { name: /elogio/i }).click()
    await page.getByLabel('Título').fill(praiseTitle)
    await page.getByLabel('Mensagem').fill('Estou adorando usar o Numora, parabéns pelo trabalho!')
    await page.getByRole('button', { name: 'Enviar feedback' }).click()

    await expect(
      page.getByText('Obrigado pelo seu feedback! Ele foi registrado e ajuda a construir o futuro do Numora.'),
    ).toBeVisible()
  })

  test('3. usuário envia uma sugestão (💡) com sucesso', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/feedback')

    await page.getByRole('button', { name: /sugestão/i }).click()
    await page.getByLabel('Título').fill(suggestionTitle)
    await page.getByLabel('Mensagem').fill('Seria ótimo ter um modo escuro mais escuro ainda.')
    await page.getByRole('button', { name: 'Enviar feedback' }).click()

    await expect(
      page.getByText('Obrigado pelo seu feedback! Ele foi registrado e ajuda a construir o futuro do Numora.'),
    ).toBeVisible()
  })

  test('4. valida feedback do tipo problema (🐛) — bloqueia envio vazio, aceita envio válido', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/feedback')

    await page.getByRole('button', { name: /encontrei um problema/i }).click()
    // Título/mensagem vazios — `required` do HTML já bloqueia o submit
    // nativamente, então o formulário nunca chega a chamar o repository.
    await page.getByRole('button', { name: 'Enviar feedback' }).click()
    await expect(
      page.getByText('Obrigado pelo seu feedback! Ele foi registrado e ajuda a construir o futuro do Numora.'),
    ).not.toBeVisible()

    await page.getByLabel('Título').fill(problemTitle)
    await page.getByLabel('Mensagem').fill('A página de coleção demora para carregar as fotos.')
    await page.getByRole('button', { name: 'Enviar feedback' }).click()

    await expect(
      page.getByText('Obrigado pelo seu feedback! Ele foi registrado e ajuda a construir o futuro do Numora.'),
    ).toBeVisible()
  })

  test('5. usuário nunca vê o feedback de outro usuário em sua própria tela', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/feedback')

    await expect(page.getByText(otherUserTitle)).toHaveCount(0)
  })

  test('6. admin abre /admin/feedback e vê os feedbacks enviados pelo usuário', async ({ page }) => {
    await loginViaUi(page, adminUser.email, adminUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/admin/feedback')

    await expect(page.getByRole('heading', { name: 'Feedback' })).toBeVisible()
    await expect(page.getByText(praiseTitle)).toBeVisible()
    await expect(page.getByText(suggestionTitle)).toBeVisible()
    await expect(page.getByText(problemTitle)).toBeVisible()
  })

  test('7. admin altera status e prioridade de um feedback', async ({ page }) => {
    await loginViaUi(page, adminUser.email, adminUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/admin/feedback')

    await page.getByText(problemTitle).click()
    await page.getByLabel('Status').selectOption('in_progress')
    await page.getByLabel('Prioridade').selectOption('high')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()

    // Modal fecha e a linha da tabela reflete o novo status/prioridade.
    await expect(page.getByRole('dialog')).not.toBeVisible()
    const row = page.getByRole('row').filter({ hasText: problemTitle })
    await expect(row.getByText('Em andamento')).toBeVisible()
    await expect(row.getByText('Alta')).toBeVisible()
  })

  test('8. admin adiciona uma observação interna', async ({ page }) => {
    await loginViaUi(page, adminUser.email, adminUser.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/admin/feedback')

    await page.getByText(problemTitle).click()
    await page.getByLabel('Observação interna (visível só para a equipe Numora)').fill(internalNoteText)
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // Reabre o mesmo feedback e confirma que a nota foi persistida.
    await page.getByText(problemTitle).click()
    await expect(page.getByLabel('Observação interna (visível só para a equipe Numora)')).toHaveValue(
      internalNoteText,
    )
  })

  test('9. a observação interna nunca aparece para o usuário comum', async ({ page }) => {
    await loginViaUi(page, user.email, user.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/feedback')
    await expect(page.getByText(internalNoteText)).toHaveCount(0)

    // Controle negativo adicional: usuário comum não consegue nem abrir a
    // área administrativa onde a nota é exibida.
    await page.goto('/admin/feedback')
    await expect(page).not.toHaveURL(/\/admin\/feedback/)
  })
})
