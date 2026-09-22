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
 * Etapa "5.10V.1 — Modelo Intermediário": a montagem dos DADOS de cada
 * linha (agregação financeira, exemplar principal, traduções PT-BR) foi
 * extraída para `features/collection/export-model.ts`
 * (`buildCollectionExportModel`) — única fonte de verdade compartilhada
 * com o futuro XLSX. Este arquivo passou a ser responsável SOMENTE pela
 * SERIALIZAÇÃO CSV (separador/BOM/CRLF/escaping/formatação numérica
 * pt-BR) a partir do modelo — comportamento externo (assinatura pública,
 * colunas, formato do arquivo) permanece IDÊNTICO ao da Etapa 5.10U, só a
 * implementação interna mudou.
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
import { buildCollectionExportModel, type CollectionExportRow } from './export-model'
import { formatDateOnly, formatTimestampDate } from '@/lib/format/date'
import type { CatalogReference, CollectionItem } from './types'

const CSV_SEPARATOR = ';'
const CSV_LINE_BREAK = '\r\n'
const CSV_BOM = '﻿'

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

function formatTags(tags: string[]): string {
  if (tags.length === 0) return ''
  return tags.join('; ')
}

function formatCatalogReferences(refs: CatalogReference[]): string {
  if (refs.length === 0) return ''
  return refs.map((ref) => `${ref.catalog} ${ref.code}`).join('; ')
}

/** Serializa UMA linha do modelo intermediário (já neutro) para o formato de texto CSV — nunca recalcula agregação/tradução, que já veio pronta do modelo. */
function toCsvRow(row: CollectionExportRow): string[] {
  return [
    formatCsvText(row.country),
    formatCsvInteger(row.year),
    formatCsvText(row.denomination),
    formatCsvText(row.mint),
    formatCsvText(row.labelCode),
    formatCsvInteger(row.quantity),
    formatCsvText(row.metal),
    formatCsvText(row.secondaryMetal),
    formatCsvDecimal(row.grossWeightG),
    formatCsvDecimal(row.purity),
    formatCsvDecimal(row.faceValue),
    formatCsvText(row.mintage),
    formatCsvDateOnly(row.purchaseDate),
    formatCsvText(row.seller),
    formatCsvText(row.location),
    formatCsvText(row.notes),
    formatCsvDecimal(row.totalCost, 2),
    formatCsvDecimal(row.costPerUnit, 2),
    formatCsvText(row.costOrigin),
    formatCsvText(row.costType),
    formatCsvText(row.grade),
    formatCsvText(row.gradeScale),
    formatCsvText(row.status),
    formatCsvInteger(row.rating),
    formatCsvBoolean(row.isPrimary),
    formatCsvText(row.description),
    formatTags(row.tags),
    formatCsvText(row.history),
    formatCsvText(row.trivia),
    formatCatalogReferences(row.catalogReferences),
    formatCsvTimestamp(row.createdAt),
  ]
}

/** Pura — testável sem fabricar um `Blob`/ambiente de browser. Exportada separadamente de `generateCollectionCsv` para poder ser testada linha a linha. Assinatura pública inalterada desde a Etapa 5.10U (continua recebendo `CollectionItem[]`) — internamente passa pelo modelo intermediário. */
export function buildCollectionExportRows(items: CollectionItem[]): string[][] {
  return buildCollectionExportModel(items).map(toCsvRow)
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
