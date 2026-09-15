/**
 * features/collection/export.ts
 * Etapa "5.10U — Exportação da Coleção" — módulo PURO de exportação:
 * recebe `CollectionItem[]` já carregado pela tela (nenhuma query própria,
 * nenhum acesso a Supabase/Stripe, nenhuma dependência de estado de
 * React). Responsável só por transformar dados em linhas e gerar o `Blob`
 * do arquivo — quem chama decide a UX de entrega (`<a download>`, nunca
 * decidido aqui) — mesmo contrato de `features/labels/pdf.ts`
 * (`generateLabelsPdf`), que também só devolve um `Blob`.
 *
 * Reaproveita a MESMA agregação financeira já usada pela tela de Coleção
 * (`features/collection/aggregate.ts`, Etapa 15.4) — nunca uma segunda
 * lógica paralela de "quanto custou esta moeda". Grão do arquivo: 1 linha
 * por `collection_item` (nunca por exemplar) — os campos "por exemplar"
 * (Grade/Escala/Status/Rating/Principal) refletem sempre o EXEMPLAR
 * PRINCIPAL do item (`getPrimaryUnit`, mesmo conceito já usado em toda a
 * UI de Coleção/Labels/Passport), nunca um exemplar arbitrário — um item
 * com múltiplos exemplares de conservação diferente não gera múltiplas
 * linhas nesta primeira versão.
 *
 * NUNCA exporta (auditoria 5.10T, seção 4): `user_id`, qualquer id interno
 * (`collection_items.id`, `purchase_id`, `collection_units.id`), valor de
 * mercado, lucro/prejuízo, ou qualquer coluna de moeda por item (não
 * existe no schema — não fabricar uma coluna "moeda" que não é dado real).
 *
 * FORMATO CSV (decisão documentada, Etapa 5.10U):
 *   - separador ';' (não ','): o Excel em locale pt-BR usa ';' como
 *     separador de campo de CSV, porque ',' já é o separador decimal
 *     nesse locale — usar ',' quebraria a importação de qualquer coluna
 *     numérica com casas decimais no Excel brasileiro.
 *   - números com vírgula decimal (pt-BR) e SEM agrupamento de milhar
 *     (useGrouping: false) — consistente com o separador acima e evita
 *     qualquer ambiguidade visual entre "milhar" e "campo" numa leitura
 *     humana do arquivo bruto.
 *   - BOM UTF-8 (`﻿`) no início do arquivo — sem isso, o Excel no
 *     Windows frequentemente detecta a codificação errada e corrompe a
 *     acentuação; Google Sheets/LibreOffice funcionam com ou sem BOM,
 *     então incluí-lo não quebra nenhum dos três.
 *   - quebras de linha CRLF (RFC 4180) — maior compatibilidade com Excel.
 *   - qualquer campo contendo o separador, aspas ou quebra de linha é
 *     envolvido em aspas duplas, com aspas internas duplicadas (escape
 *     padrão RFC 4180) — cobre acentuação, vendedores/observações com
 *     vírgula ou ponto-e-vírgula, e listas (tags/referências) unidas por
 *     "; " dentro de um único campo.
 */
import { getItemAcquisitionSummary, getPrimaryUnit } from './aggregate'
import { COLLECTION_UNIT_STATUS_LABELS, type CostOrigin, type CostType } from '@/features/collection-units/types'
import { formatDateOnly, formatTimestampDate } from '@/lib/format/date'
import type { CatalogReference, CollectionItem } from './types'

const CSV_SEPARATOR = ';'
const CSV_LINE_BREAK = '\r\n'
const CSV_BOM = '﻿'

const COST_ORIGIN_LABELS: Record<CostOrigin, string> = {
  auto: 'Automático (rateio)',
  manual: 'Manual',
}

const COST_TYPE_LABELS: Record<CostType, string> = {
  purchase: 'Compra',
  trade: 'Troca',
  gift: 'Presente',
  unknown: 'Desconhecido',
}

const CSV_HEADERS = [
  'País',
  'Ano',
  'Denominação',
  'Casa da moeda',
  'Label Code',
  'Quantidade',
  'Metal',
  'Metal secundário',
  'Peso bruto',
  'Pureza',
  'Valor facial',
  'Cunhagem',
  'Data de compra',
  'Vendedor',
  'Local',
  'Observações',
  'Custo de compra',
  'Custo por unidade',
  'Origem do custo',
  'Tipo do custo',
  'Grade',
  'Escala da grade',
  'Status',
  'Rating',
  'Principal',
  'Descrição',
  'Tags',
  'Histórico',
  'Curiosidades',
  'Referências de catálogo',
  'Data de criação',
]

function escapeCsvField(value: string): string {
  if (value.includes(CSV_SEPARATOR) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function csvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(CSV_SEPARATOR)
}

function formatCsvText(value: string | null | undefined): string {
  return value ?? ''
}

/** Inteiros "de contagem/identificação" (ano, quantidade, rating) — NUNCA formatados via locale: `(2024).toLocaleString('pt-BR')` produziria "2.024" (ponto de milhar), errado para um ano. */
function formatCsvInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Valores decimais reais (peso, pureza, valor facial, custo) — vírgula decimal, sem agrupamento de milhar (ver comentário do cabeçalho do arquivo). */
function formatCsvDecimal(value: number | null | undefined, fractionDigits?: number): string {
  if (value === null || value === undefined) return ''
  return value.toLocaleString('pt-BR', {
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

function formatCsvDateOnly(value: string | null | undefined): string {
  return value ? formatDateOnly(value) : ''
}

function formatCsvTimestamp(value: string | null | undefined): string {
  return value ? formatTimestampDate(value) : ''
}

function formatCsvBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value ? 'Sim' : 'Não'
}

function formatTags(tags: string[] | null): string {
  if (!tags || tags.length === 0) return ''
  return tags.join('; ')
}

function formatCatalogReferences(refs: CatalogReference[] | null): string {
  if (!refs || refs.length === 0) return ''
  return refs.map((ref) => `${ref.catalog} ${ref.code}`).join('; ')
}

function buildExportRow(item: CollectionItem): string[] {
  const summary = getItemAcquisitionSummary(item)
  const primaryUnit = getPrimaryUnit(item)
  // "Nenhum exemplar tem custo conhecido" (nunca confundir com custo real
  // R$0) — mesma distinção já usada por `getItemAcquisitionSummary` em
  // toda a UI de Coleção (ver features/collection/aggregate.ts).
  const hasKnownCost = !(summary.isUniform && summary.uniformCost === null)

  return [
    formatCsvText(item.countryDisplayName),
    formatCsvInteger(item.year),
    formatCsvText(item.denomination),
    formatCsvText(item.mint),
    formatCsvText(item.labelCode),
    formatCsvInteger(item.quantity),
    formatCsvText(item.metalName),
    formatCsvText(item.secondaryMetalName),
    formatCsvDecimal(item.grossWeightG),
    formatCsvDecimal(item.purity),
    formatCsvDecimal(item.faceValue),
    formatCsvText(item.mintage),
    formatCsvDateOnly(item.purchase?.purchaseDate ?? null),
    formatCsvText(item.purchase?.sellerName ?? null),
    formatCsvText(item.location),
    formatCsvText(item.purchase?.notes ?? null),
    hasKnownCost ? formatCsvDecimal(summary.totalInvested, 2) : '',
    // Etapa 5.10U — achado real ao escrever o teste: `averageCost` só é
    // `null` quando o item não tem NENHUM exemplar; quando todo exemplar
    // tem `unitCost = null` (custo desconhecido), `getItemAverageAcquisitionCost`
    // devolve 0 (trata desconhecido como 0 na soma, mesma regra documentada
    // em aggregate.ts) — usar `hasKnownCost` aqui (o mesmo gate da coluna
    // anterior) em vez de `averageCost !== null` evita mostrar "0,00" para
    // um custo genuinamente desconhecido.
    hasKnownCost ? formatCsvDecimal(summary.averageCost, 2) : '',
    // Origem/tipo do custo só fazem sentido como UM valor quando todos os
    // exemplares do item compartilham o mesmo custo (isUniform) — do
    // contrário, mostrar a origem só do exemplar principal seria
    // enganoso (sugeriria que vale para o item inteiro).
    summary.isUniform && primaryUnit ? COST_ORIGIN_LABELS[primaryUnit.costOrigin] : '',
    summary.isUniform && primaryUnit ? COST_TYPE_LABELS[primaryUnit.costType] : '',
    formatCsvText(primaryUnit?.gradeLabel ?? null),
    formatCsvText(primaryUnit?.gradeScale ?? null),
    primaryUnit ? COLLECTION_UNIT_STATUS_LABELS[primaryUnit.status] : '',
    formatCsvInteger(primaryUnit?.rating ?? null),
    formatCsvBoolean(primaryUnit?.isPrimary ?? null),
    formatCsvText(item.description),
    formatTags(item.tags),
    formatCsvText(item.history),
    formatCsvText(item.trivia),
    formatCatalogReferences(item.catalogReferences),
    formatCsvTimestamp(item.createdAt),
  ]
}

/** Pura — testável sem fabricar um `Blob`/ambiente de browser. Exportada separadamente de `generateCollectionCsv` para poder ser testada linha a linha. */
export function buildCollectionExportRows(items: CollectionItem[]): string[][] {
  return items.map(buildExportRow)
}

/** `items.length === 0` ainda gera um arquivo válido — só o cabeçalho, nunca um Blob vazio/corrompido. A decisão de bloquear a exportação de uma coleção vazia (se houver) é da UI, não deste módulo. */
export function generateCollectionCsv(items: CollectionItem[]): Blob {
  const rows = [CSV_HEADERS, ...buildCollectionExportRows(items)]
  const content = CSV_BOM + rows.map(csvRow).join(CSV_LINE_BREAK) + CSV_LINE_BREAK
  return new Blob([content], { type: 'text/csv;charset=utf-8;' })
}

/** Nenhum dado pessoal no nome do arquivo — só a data da exportação (Etapa 5.10U, seção 4). */
export function buildCollectionExportFilename(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `numora-colecao-${year}-${month}-${day}.csv`
}
