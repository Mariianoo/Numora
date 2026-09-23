/**
 * tests/unit/export-format-dialog.test.ts
 * Etapa "XLSX UI Integration" — `components/collection/ExportFormatDialog.tsx`.
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de
 * tests/unit/collection-page-export-regression.test.ts e
 * tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts): este
 * repositório não tem infraestrutura para renderizar um componente React
 * (vitest.config.mts roda `environment: 'node'`, sem jsdom, sem
 * testing-library, e o glob de `tests/unit` só pega `*.test.ts`, nunca
 * `.tsx`) — não é possível "clicar" nos botões "CSV"/"Excel (.xlsx)" e
 * observar o DOM aqui. Por isso este arquivo usa a mesma técnica de teste
 * de caracterização já estabelecida no projeto: inspeciona o CÓDIGO-FONTE
 * do componente como texto.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIALOG_FILE_PATH = path.resolve(__dirname, '../../components/collection/ExportFormatDialog.tsx')

function readDialogSource(): string {
  return readFileSync(DIALOG_FILE_PATH, 'utf8')
}

describe('ExportFormatDialog', () => {
  it('o arquivo do componente existe e é legível (pré-condição do teste)', () => {
    expect(() => readDialogSource()).not.toThrow()
  })

  it('reutiliza o Modal genérico do design system — nunca reimplementa overlay/Escape/focus trap', () => {
    const source = readDialogSource()
    expect(source).toMatch(/import \{ Modal \} from '@\/components\/ui\/Modal'/)
    expect(source).toMatch(/<Modal/)
    // Nunca introduz um novo primitivo de dialog/menu genérico neste componente.
    expect(source).not.toMatch(/role=["']dialog["']/)
    expect(source).not.toMatch(/role=["']menu["']/)
  })

  it('título é "Exportar coleção" e a descrição orienta a escolha de formato', () => {
    const source = readDialogSource()
    expect(source).toMatch(/title="Exportar coleção"/)
    expect(source).toMatch(/description="Escolha o formato do arquivo\."/)
  })

  it('opção CSV está presente e chama onSelect(\'csv\')', () => {
    const source = readDialogSource()
    expect(source).toMatch(/>\s*CSV\s*</)
    expect(source).toMatch(/onClick=\{\(\) => onSelect\('csv'\)\}/)
  })

  it('opção Excel (.xlsx) está presente e chama onSelect(\'xlsx\')', () => {
    const source = readDialogSource()
    expect(source).toMatch(/Excel \(\.xlsx\)/)
    expect(source).toMatch(/onClick=\{\(\) => onSelect\('xlsx'\)\}/)
  })

  it('nenhum gerador de arquivo é IMPORTADO/CHAMADO aqui (só citado em comentário explicando o contrato) — só informa o formato escolhido via onSelect', () => {
    const source = readDialogSource()
    expect(source).not.toMatch(/generateCollectionCsv\(/)
    expect(source).not.toMatch(/generateCollectionXlsx\(/)
    expect(source).not.toMatch(/triggerBrowserDownload\(/)
    expect(source).not.toMatch(/trackExportCompleted\(/)
    expect(source).not.toMatch(/from '@\/features\/collection\/export/)
  })

  it('nenhuma checagem de entitlement/plano é feita aqui — o chamador já confirmou `exports` antes de abrir este diálogo', () => {
    const source = readDialogSource()
    expect(source).not.toMatch(/isEnabled\(/)
    expect(source).not.toMatch(/'exports'/)
    expect(source).not.toMatch(/<UpgradeToProDialog/)
  })

  it('cancelamento (botão "Cancelar") chama handleClose/onClose — NUNCA onSelect', () => {
    const source = readDialogSource()
    const cancelButtonStart = source.indexOf('Cancelar')
    const cancelButtonBlockStart = source.lastIndexOf('<Button', cancelButtonStart)
    expect(cancelButtonBlockStart).toBeGreaterThan(-1)

    const cancelButtonBlock = source.slice(cancelButtonBlockStart, cancelButtonStart)
    expect(cancelButtonBlock).toMatch(/onClick=\{handleClose\}/)
    expect(cancelButtonBlock).not.toMatch(/onSelect/)
  })

  it('handleClose nunca fecha o diálogo com uma geração em voo (isBusy = generatingFormat !== null)', () => {
    const source = readDialogSource()
    const handlerStart = source.indexOf('function handleClose')
    const handlerEnd = source.indexOf('return (', handlerStart)
    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)

    const handlerBody = source.slice(handlerStart, handlerEnd)
    expect(handlerBody).toMatch(/if \(isBusy\) return/)
    expect(handlerBody).toMatch(/onClose\(\)/)
  })

  it('os dois botões de formato ficam desabilitados durante qualquer geração em voo (disabled={isBusy})', () => {
    const source = readDialogSource()
    const csvButtonIndex = source.indexOf("onSelect('csv')")
    const xlsxButtonIndex = source.indexOf("onSelect('xlsx')")
    expect(csvButtonIndex).toBeGreaterThan(-1)
    expect(xlsxButtonIndex).toBeGreaterThan(-1)

    // Cada botão de formato tem seu próprio `disabled={isBusy}` na mesma tag JSX.
    const csvButtonEnd = source.indexOf('</Button>', csvButtonIndex)
    const xlsxButtonEnd = source.indexOf('</Button>', xlsxButtonIndex)
    expect(source.slice(csvButtonIndex, csvButtonEnd)).toMatch(/disabled=\{isBusy\}/)
    expect(source.slice(xlsxButtonIndex, xlsxButtonEnd)).toMatch(/disabled=\{isBusy\}/)
  })

  it('o spinner (isLoading) de cada botão reflete só o formato efetivamente escolhido, nunca os dois ao mesmo tempo', () => {
    const source = readDialogSource()
    const csvButtonIndex = source.indexOf("onSelect('csv')")
    const xlsxButtonIndex = source.indexOf("onSelect('xlsx')")
    const csvButtonEnd = source.indexOf('</Button>', csvButtonIndex)
    const xlsxButtonEnd = source.indexOf('</Button>', xlsxButtonIndex)

    expect(source.slice(csvButtonIndex, csvButtonEnd)).toMatch(/isLoading=\{generatingFormat === 'csv'\}/)
    expect(source.slice(xlsxButtonIndex, xlsxButtonEnd)).toMatch(/isLoading=\{generatingFormat === 'xlsx'\}/)
  })
})
