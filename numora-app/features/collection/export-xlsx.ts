/**
 * features/collection/export-xlsx.ts
 * Etapa "5.10V.2 — Excel Premium da Coleção" — módulo puro quanto
 * possível: recebe `CollectionItem[]` já carregado pela tela, monta o
 * workbook via `write-excel-file/universal` e devolve um `Blob` — nunca
 * decide UX de entrega (`<a download>`), nunca acessa Supabase/Stripe,
 * nunca faz upload/Storage. Mesmo contrato de `features/collection/export.ts`
 * (`generateCollectionCsv`) e `features/labels/pdf.ts` (`generateLabelsPdf`).
 *
 * Reaproveita o MESMO modelo intermediário do CSV
 * (`features/collection/export-model.ts`, `buildCollectionExportModel`/
 * `computeCollectionExportSummary`) — nunca uma segunda lógica paralela de
 * extração/tradução/agregação. As 31 colunas da aba "Coleção" são
 * exatamente as mesmas do CSV, só com tipos de célula reais do Excel
 * (Number/Date) em vez de texto formatado.
 *
 * DEPENDÊNCIA: `write-excel-file@4.1.1` (MIT), importada do subpath
 * `/universal` (nunca `/browser` nem o export default `write-excel-file`)
 * — é o único dos três que devolve `{ toBlob(): Promise<Blob> }` em vez de
 * disparar um download automático sozinho, preservando o mesmo contrato
 * "só devolve Blob, quem chama decide a entrega" das etapas anteriores.
 * Escolhida sobre ExcelJS por causa de um advisory de segurança sem
 * correção na última versão publicada do ExcelJS no momento da auditoria
 * 5.10V.1 (CVE-2026-78206, DoS por descompressão) — ver relatório daquela
 * etapa. `npm audit` após a instalação: 0 vulnerabilidades na árvore
 * efetivamente instalada.
 *
 * IDENTIDADE VISUAL: reaproveita a MESMA paleta de impressão Navy/Gold já
 * estabelecida em `features/labels/pdf.ts` (Etapa "F4 — Numora Labels") —
 * nunca uma paleta nova inventada para este relatório. Logo em imagem
 * (raster) NÃO foi embutido nesta primeira versão — decisão deliberada:
 * embutir a imagem exigiria um `fetch()` do asset estático em
 * `public/brand/`, uma operação assíncrona/de rede que tornaria este
 * módulo mais difícil de testar de forma determinística (o ambiente de
 * testes deste projeto roda em Node puro, sem `fetch`/`document`
 * disponíveis por padrão — ver vitest.config.mts, `environment: 'node'`).
 * A identidade visual desta versão vem inteiramente de texto estilizado
 * (título "NUMORA" em Navy/Gold, mesma paleta) — a biblioteca já suporta
 * `images` nativamente (`SheetOptions.images`) para quando o logo raster
 * for adicionado numa etapa futura.
 *
 * NUNCA inclui (mesma garantia do modelo/CSV): `user_id`, qualquer id
 * interno, valor de mercado, patrimônio, lucro/prejuízo, ou símbolo de
 * moeda em qualquer valor financeiro (não existe coluna de moeda por item
 * no schema).
 */
import writeXlsxFile, { getSheetData } from 'write-excel-file/universal'
import type { CellObject, Column, Row, Sheet, SheetData } from 'write-excel-file/universal'

import { buildCollectionExportModel, computeCollectionExportSummary, type CollectionExportRow, type DistributionEntry } from './export-model'
import type { CollectionItem } from './types'

/** Mesma paleta de impressão já estabelecida em features/labels/pdf.ts — nunca uma paleta nova. */
const BRAND_NAVY = '#0B1F3B'
const BRAND_GOLD = '#D4AF37'
const BRAND_WHITE = '#FFFFFF'

/** Sem agrupamento de milhar (`#,##0`), mesma decisão já documentada no CSV (features/collection/export.ts) — consistência entre os dois formatos. */
const DECIMAL_FORMAT = '0.####'
const MONEY_LIKE_FORMAT = '0.00'
const DATE_FORMAT = 'dd/mm/yyyy'

function headerCell(text: string): CellObject {
  return {
    value: text,
    fontWeight: 'bold',
    backgroundColor: BRAND_NAVY,
    textColor: BRAND_WHITE,
    align: 'center',
    alignVertical: 'center',
    wrap: true,
  }
}

/**
 * Data de CALENDÁRIO (`YYYY-MM-DD`, sem horário) → `Date` à meia-noite UTC.
 * `write-excel-file` serializa `Date` pelo instante UTC
 * (`getTime() / 86400000`, sem noção de fuso) e o Excel exibe o dia desse
 * número de série — meia-noite LOCAL cairia no dia anterior em qualquer
 * fuso UTC+1 ou superior. Extrai os componentes literais (nunca
 * `new Date(isoString)`, mesma técnica de `lib/format/date.ts`) e fixa a
 * meia-noite UTC: o mesmo dia em qualquer fuso do processo.
 */
function parseDateOnlyToUtcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Instante (`timestamptz`, ex.: `createdAt`) exibido como data sem horário
 * → o dia de calendário LOCAL do instante (o mesmo que o CSV mostra via
 * `toLocaleDateString`), serializado como meia-noite UTC pelo motivo acima.
 * Sem isto, um item criado às 22h em UTC-3 apareceria com o dia seguinte no
 * Excel (dia UTC do instante) e com o dia certo no CSV.
 */
function instantToLocalCalendarDate(isoTimestamp: string): Date {
  const instant = new Date(isoTimestamp)
  return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()))
}

function textColumn(header: string, width: number, pick: (row: CollectionExportRow) => string | null): Column<CollectionExportRow> {
  return { header: headerCell(header), width, cell: (row) => pick(row) }
}

/** Anos/quantidades/ratings — inteiros simples, formato 'General' do Excel já exibe sem agrupamento de milhar (nunca precisa de `format` explícito). */
function integerColumn(header: string, width: number, pick: (row: CollectionExportRow) => number | null): Column<CollectionExportRow> {
  return { header: headerCell(header), width, cell: (row) => pick(row) }
}

function decimalColumn(header: string, width: number, pick: (row: CollectionExportRow) => number | null): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => {
      const value = pick(row)
      return value === null ? null : { value, format: DECIMAL_FORMAT }
    },
  }
}

/** Custo — número real, SEM símbolo de moeda (nunca "R$"/"$" — não existe coluna de moeda por item no schema, auditoria 5.10T/5.10V). */
function moneyLikeColumn(header: string, width: number, pick: (row: CollectionExportRow) => number | null): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => {
      const value = pick(row)
      return value === null ? null : { value, format: MONEY_LIKE_FORMAT }
    },
  }
}

function dateOnlyColumn(header: string, width: number, pick: (row: CollectionExportRow) => string | null): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => {
      const iso = pick(row)
      return iso === null ? null : { value: parseDateOnlyToUtcDate(iso), format: DATE_FORMAT }
    },
  }
}

function timestampColumn(header: string, width: number, pick: (row: CollectionExportRow) => string): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => ({ value: instantToLocalCalendarDate(pick(row)), format: DATE_FORMAT }),
  }
}

function booleanAsTextColumn(header: string, width: number, pick: (row: CollectionExportRow) => boolean | null): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => {
      const value = pick(row)
      return value === null ? null : value ? 'Sim' : 'Não'
    },
  }
}

function listColumn(header: string, width: number, pick: (row: CollectionExportRow) => string[]): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => {
      const list = pick(row)
      return list.length === 0 ? null : list.join('; ')
    },
  }
}

function catalogReferencesColumn(header: string, width: number): Column<CollectionExportRow> {
  return {
    header: headerCell(header),
    width,
    cell: (row) => (row.catalogReferences.length === 0 ? null : row.catalogReferences.map((ref) => `${ref.catalog} ${ref.code}`).join('; ')),
  }
}

/**
 * Exatamente as 31 colunas do CSV (features/collection/export.ts,
 * `CSV_HEADERS`), na mesma ordem — única diferença é o TIPO de célula
 * (Number/Date reais em vez de texto formatado). `mintage` permanece
 * TEXTO (nunca `Number`) pelo mesmo motivo já documentado em
 * `CollectionRepository`/`export-model.ts`: é um `bigint` no Postgres, um
 * `number` do JS/Excel corromperia valores acima de
 * `Number.MAX_SAFE_INTEGER`.
 */
const COLLECTION_COLUMNS: Column<CollectionExportRow>[] = [
  textColumn('País', 18, (r) => r.country),
  integerColumn('Ano', 8, (r) => r.year),
  textColumn('Denominação', 18, (r) => r.denomination),
  textColumn('Casa da moeda', 16, (r) => r.mint),
  textColumn('Label Code', 14, (r) => r.labelCode),
  integerColumn('Quantidade', 12, (r) => r.quantity),
  textColumn('Metal', 16, (r) => r.metal),
  textColumn('Metal secundário', 16, (r) => r.secondaryMetal),
  decimalColumn('Peso bruto', 12, (r) => r.grossWeightG),
  decimalColumn('Pureza', 10, (r) => r.purity),
  decimalColumn('Valor facial', 12, (r) => r.faceValue),
  textColumn('Cunhagem', 16, (r) => r.mintage),
  dateOnlyColumn('Data de compra', 14, (r) => r.purchaseDate),
  textColumn('Vendedor', 20, (r) => r.seller),
  textColumn('Local', 18, (r) => r.location),
  textColumn('Observações', 30, (r) => r.notes),
  moneyLikeColumn('Custo de compra', 14, (r) => r.totalCost),
  moneyLikeColumn('Custo por unidade', 16, (r) => r.costPerUnit),
  textColumn('Origem do custo', 18, (r) => r.costOrigin),
  textColumn('Tipo do custo', 14, (r) => r.costType),
  textColumn('Grade', 10, (r) => r.grade),
  textColumn('Escala da grade', 14, (r) => r.gradeScale),
  textColumn('Status', 20, (r) => r.status),
  integerColumn('Rating', 8, (r) => r.rating),
  booleanAsTextColumn('Principal', 10, (r) => r.isPrimary),
  textColumn('Descrição', 30, (r) => r.description),
  listColumn('Tags', 20, (r) => r.tags),
  textColumn('Histórico', 30, (r) => r.history),
  textColumn('Curiosidades', 30, (r) => r.trivia),
  catalogReferencesColumn('Referências de catálogo', 24),
  timestampColumn('Data de criação', 14, (r) => r.createdAt),
]

function buildCollectionSheet(rows: CollectionExportRow[]): Sheet<Blob> {
  return {
    sheet: 'Coleção',
    data: getSheetData(rows, COLLECTION_COLUMNS),
    columns: COLLECTION_COLUMNS,
    // Congela a linha de cabeçalho — "freeze panes" (Etapa 5.10V.2, seção 4).
    stickyRowsCount: 1,
  }
}

function titleCell(text: string): CellObject {
  return { value: text, fontWeight: 'bold', fontSize: 22, textColor: BRAND_NAVY }
}

function subtitleCell(text: string): CellObject {
  return { value: text, fontWeight: 'bold', fontSize: 13, textColor: BRAND_GOLD }
}

function sectionHeadingCell(text: string): CellObject {
  return { value: text, fontWeight: 'bold', backgroundColor: BRAND_GOLD, textColor: BRAND_NAVY }
}

function labelCell(text: string): CellObject {
  return { value: text, fontWeight: 'bold' }
}

function indicatorRow(label: string, value: string | CellObject): Row {
  return [labelCell(label), value]
}

function formatGenerationDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getFullYear()}`
}

/** Trata elegantemente uma distribuição vazia (Etapa 5.10V.2, seção 6) — nunca uma tabela quebrada/em branco. */
function distributionSectionRows(title: string, entries: DistributionEntry[]): SheetData {
  const rows: SheetData = [[sectionHeadingCell(title), null]]
  if (entries.length === 0) {
    rows.push(['Nenhum dado disponível.', null])
    return rows
  }
  for (const entry of entries) {
    rows.push([entry.label, { value: entry.count }])
  }
  return rows
}

function buildSummarySheetData(summary: ReturnType<typeof computeCollectionExportSummary>): SheetData {
  const rows: SheetData = []

  rows.push([titleCell('NUMORA'), null])
  rows.push([subtitleCell('Relatório da Minha Coleção Numismática'), null])
  rows.push([{ value: `Gerado em ${formatGenerationDate(new Date())}`, fontStyle: 'italic', textColor: '#555555' }, null])
  rows.push([null, null])

  rows.push([sectionHeadingCell('Indicadores'), null])
  rows.push(indicatorRow('Total de itens', { value: summary.totalItems }))
  rows.push(indicatorRow('Total de exemplares', { value: summary.totalUnits }))
  rows.push(indicatorRow('Países representados', { value: summary.countriesRepresented }))
  rows.push(indicatorRow('Anos representados', { value: summary.yearsRepresented }))
  rows.push(indicatorRow('Compras registradas', { value: summary.registeredPurchases }))
  rows.push(
    indicatorRow(
      'Primeira aquisição',
      summary.firstAcquisitionDate === null ? '—' : { value: parseDateOnlyToUtcDate(summary.firstAcquisitionDate), format: DATE_FORMAT },
    ),
  )
  rows.push(
    indicatorRow(
      'Última aquisição',
      summary.lastAcquisitionDate === null ? '—' : { value: parseDateOnlyToUtcDate(summary.lastAcquisitionDate), format: DATE_FORMAT },
    ),
  )
  // "Se não for seguro apresentar, omitir" (Etapa 5.10V.2, seção 5) —
  // omite a linha inteira quando NENHUM item tem custo conhecido, nunca
  // mostra "0" nem inventa um símbolo de moeda.
  if (summary.totalKnownCost !== null) {
    rows.push(indicatorRow('Custo total de aquisição conhecido', { value: summary.totalKnownCost, format: MONEY_LIKE_FORMAT }))
  }
  rows.push([null, null])

  rows.push(...distributionSectionRows('Coleção por país', summary.countryDistribution))
  rows.push([null, null])
  rows.push(...distributionSectionRows('Coleção por metal', summary.metalDistribution))
  rows.push([null, null])
  rows.push(...distributionSectionRows('Coleção por status', summary.statusDistribution))
  rows.push([null, null])
  rows.push(...distributionSectionRows('Coleção por década', summary.decadeDistribution))

  return rows
}

function buildSummarySheet(rows: CollectionExportRow[]): Sheet<Blob> {
  return {
    sheet: 'Resumo',
    data: buildSummarySheetData(computeCollectionExportSummary(rows)),
    columns: [{ width: 34 }, { width: 20 }],
  }
}

/**
 * Gera o `.xlsx` completo (abas "Resumo" + "Coleção") a partir de
 * `CollectionItem[]` já carregado pela tela — nenhuma query própria,
 * nenhum acesso a Supabase/Stripe, nenhum upload/Storage. Quem chama
 * decide a UX de entrega (`<a download>`), nunca decidido aqui.
 */
export async function generateCollectionXlsx(items: CollectionItem[]): Promise<Blob> {
  const rows = buildCollectionExportModel(items)

  const sheets: Sheet<Blob>[] = [buildSummarySheet(rows), buildCollectionSheet(rows)]

  return writeXlsxFile(sheets, { fontFamily: 'Calibri', fontSize: 11 }).toBlob()
}

/** Nenhum dado pessoal no nome do arquivo — mesma decisão já tomada para o CSV (Etapa 5.10U). */
export function buildCollectionExportXlsxFilename(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `numora-colecao-${year}-${month}-${day}.xlsx`
}
