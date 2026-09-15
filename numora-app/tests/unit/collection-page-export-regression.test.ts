/**
 * tests/unit/collection-page-export-regression.test.ts
 * Etapa "5.10U — Exportação da Coleção".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de
 * tests/unit/account-delete-billing-guard-regression.test.ts e
 * tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts): este
 * repositório não tem infraestrutura para renderizar
 * `app/dashboard/collection/page.tsx` (Server/Client Component gigante,
 * `environment: 'node'` sem jsdom/testing-library) — não é possível
 * "clicar" no botão "Exportar coleção" e observar o DOM aqui. A lógica
 * pura de geração do arquivo já está coberta isoladamente em
 * tests/unit/collection-export.test.ts, e o entitlement em
 * tests/unit/export-entitlement-repository.test.ts — o que falta cobrir é
 * exclusivamente a ORQUESTRAÇÃO dentro da página: ordem das chamadas, e
 * que o novo botão nunca poderia acidentalmente chamar Stripe ou escrever
 * no Supabase.
 *
 * Por isso este arquivo usa a mesma técnica de teste de caracterização já
 * estabelecida no projeto: inspeciona o CÓDIGO-FONTE da página como texto.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE_FILE_PATH = path.resolve(__dirname, '../../app/dashboard/collection/page.tsx')

function readPageSource(): string {
  return readFileSync(PAGE_FILE_PATH, 'utf8')
}

function extractFunctionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('app/dashboard/collection/page.tsx — botão "Exportar coleção" (5.10U)', () => {
  it('o arquivo da página existe e é legível (pré-condição do teste)', () => {
    expect(() => readPageSource()).not.toThrow()
  })

  it('existe um botão "Exportar coleção" ligado a handleExportCollection, na Collection (não duplicado em outra página)', () => {
    const source = readPageSource()
    expect(source).toMatch(/onClick=\{handleExportCollection\}/)
    expect(source).toMatch(/Exportar coleção/)
  })

  it('handleExportCollection consulta exportEntitlementRepository.isEnabled() ANTES de gerar qualquer arquivo', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    const isEnabledIndex = body.indexOf('exportEntitlementRepository.isEnabled()')
    const generateIndex = body.indexOf('generateCollectionCsv(')

    expect(isEnabledIndex).toBeGreaterThan(-1)
    expect(generateIndex).toBeGreaterThan(-1)
    expect(isEnabledIndex).toBeLessThan(generateIndex)
  })

  it('quando o entitlement está desabilitado, abre o UpgradeToProDialog (isExportUpgradeDialogOpen) — nunca chama generateCollectionCsv', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    const blockedBranchStart = body.indexOf('if (!enabled)')
    const blockedBranchEnd = body.indexOf('}', body.indexOf('setIsExportUpgradeDialogOpen(true)'))
    expect(blockedBranchStart).toBeGreaterThan(-1)

    const blockedBranch = body.slice(blockedBranchStart, blockedBranchEnd)
    expect(blockedBranch).toMatch(/setIsExportUpgradeDialogOpen\(true\)/)
    expect(blockedBranch).not.toMatch(/generateCollectionCsv\(/)
  })

  it('handleExportCollection NUNCA chama Stripe/Checkout nem escreve no Supabase (só leitura via isEnabled)', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    expect(body).not.toMatch(/getStripeClient/)
    expect(body).not.toMatch(/'\/api\/billing\/checkout'/)
    expect(body).not.toMatch(/\.insert\(/)
    expect(body).not.toMatch(/\.update\(/)
    expect(body).not.toMatch(/\.delete\(/)
    expect(body).not.toMatch(/collectionRepository\.(list|create|update)\(/)
  })

  it('handleExportCollection NUNCA faz uma nova query de coleção — usa o array `items` já carregado pela tela', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    expect(body).toMatch(/generateCollectionCsv\(items\)/)
  })

  it('trackExportCompleted só é chamado DEPOIS de triggerBrowserDownload (nunca antes, nunca no clique bruto)', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    const downloadIndex = body.indexOf('triggerBrowserDownload(')
    const trackIndex = body.indexOf('trackExportCompleted(')

    expect(downloadIndex).toBeGreaterThan(-1)
    expect(trackIndex).toBeGreaterThan(-1)
    expect(trackIndex).toBeGreaterThan(downloadIndex)
  })

  it('trackExportCompleted NUNCA aparece dentro do catch externo de handleExportCollection (falha de geração não dispara o evento)', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    // Âncora única (não depende de indentação exata): localiza o catch
    // EXTERNO pelo texto que só ele contém, depois isola seu corpo entre o
    // `catch` mais próximo antes dela e o `finally` da função.
    const outerCatchAnchor = 'setExportError(getUserFriendlyErrorMessage(err))'
    const anchorIndex = body.indexOf(outerCatchAnchor)
    expect(anchorIndex).toBeGreaterThan(-1)

    const outerCatchStart = body.lastIndexOf('catch (err) {', anchorIndex)
    const outerCatchEnd = body.indexOf('finally', anchorIndex)
    expect(outerCatchStart).toBeGreaterThan(-1)
    expect(outerCatchEnd).toBeGreaterThan(outerCatchStart)

    const outerCatchBody = body.slice(outerCatchStart, outerCatchEnd)
    expect(outerCatchBody).not.toMatch(/trackExportCompleted\(/)
  })

  it('coleção vazia mostra um erro amigável e NUNCA chama generateCollectionCsv (não gera arquivo inválido)', () => {
    const source = readPageSource()
    const body = extractFunctionBody(source, 'async function handleExportCollection', 'async function openAddModal')

    const emptyBranchStart = body.indexOf('if (items.length === 0)')
    const emptyBranchEnd = body.indexOf('const csvBlob = generateCollectionCsv')
    expect(emptyBranchStart).toBeGreaterThan(-1)
    expect(emptyBranchEnd).toBeGreaterThan(emptyBranchStart)

    const emptyBranch = body.slice(emptyBranchStart, emptyBranchEnd)
    expect(emptyBranch).toMatch(/setExportError\(/)
    expect(emptyBranch).not.toMatch(/generateCollectionCsv\(/)
  })

  it('segundo UpgradeToProDialog (trigger "export") existe, separado do dialog de limite de coleção (trigger "collection_limit")', () => {
    const source = readPageSource()
    const collectionLimitDialogIndex = source.indexOf('trigger="collection_limit"')
    const exportDialogIndex = source.indexOf('trigger="export"')

    expect(collectionLimitDialogIndex).toBeGreaterThan(-1)
    expect(exportDialogIndex).toBeGreaterThan(-1)
    expect(exportDialogIndex).not.toBe(collectionLimitDialogIndex)
  })

  it('o dialog de limite de coleção (checkout existente) permanece com isOpen={isUpgradeDialogOpen} — nunca reaproveitado/alterado pelo fluxo de export', () => {
    const source = readPageSource()
    expect(source).toMatch(/isOpen=\{isUpgradeDialogOpen\}[\s\S]{0,400}trigger="collection_limit"/)
  })

  it('triggerBrowserDownload nunca usa window.open (achado documentado do LabelGeneratorModal — popup blocker após await)', () => {
    const source = readPageSource()
    const fnStart = source.indexOf('function triggerBrowserDownload')
    const fnEnd = source.indexOf('\n}', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).not.toMatch(/window\.open/)
    expect(fnBody).toMatch(/anchor\.click\(\)/)
    expect(fnBody).toMatch(/URL\.revokeObjectURL/)
  })
})
