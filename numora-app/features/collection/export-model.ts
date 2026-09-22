/**
 * features/collection/export-model.ts
 * Etapa "5.10V.1 — Modelo Intermediário de Exportação" — única fonte de
 * verdade sobre QUAIS dados de `CollectionItem[]` são exportáveis, e em
 * que FORMA NEUTRA (números continuam `number`, datas continuam string
 * ISO, listas continuam array) — nunca pré-formatado para um destino
 * específico (CSV/XLSX/PDF). Cada formato de saída decide sua própria
 * apresentação a partir deste modelo (separador, casas decimais, tipo de
 * célula real do Excel, etc.) — nunca duplica a extração/tradução dos
 * dados em si.
 *
 *   CollectionRepository.list()
 *           ↓
 *   buildCollectionExportModel(items)   ← este arquivo
 *           ↓
 *      ┌────┴────┐
 *      ↓         ↓
 *     CSV      XLSX  (features/collection/export.ts / export-xlsx.ts)
 *
 * Reaproveita a MESMA agregação financeira já usada pela tela de Coleção
 * (features/collection/aggregate.ts, Etapa 15.4) e as mesmas traduções
 * PT-BR já estabelecidas (`COLLECTION_UNIT_STATUS_LABELS`) — nunca uma
 * segunda lógica paralela.
 *
 * Grão: 1 linha por `collection_item` (nunca por exemplar) — campos "do
 * exemplar" (grade/status/rating/isPrimary/custo) refletem sempre o
 * EXEMPLAR PRINCIPAL (`getPrimaryUnit`), mesmo critério já usado em toda a
 * UI de Coleção/Labels/Passport.
 *
 * NUNCA inclui (auditoria 5.10T/5.10V): `user_id`, qualquer id interno
 * (`collection_items.id`, `purchase_id`, `collection_units.id`), valor de
 * mercado, patrimônio, lucro/prejuízo, valorização, cotação, ou qualquer
 * coluna de moeda por item (não existe no schema — nunca fabricar uma).
 */
import { getItemAcquisitionSummary, getPrimaryUnit } from './aggregate'
import { COLLECTION_UNIT_STATUS_LABELS, type CostOrigin, type CostType } from '@/features/collection-units/types'
import type { CatalogReference, CollectionItem } from './types'

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

/**
 * Uma linha exportável — campos em forma NEUTRA (nunca string já
 * formatada para exibição): números continuam `number`, datas continuam
 * string ISO, listas continuam array. `null` sempre significa "dado
 * desconhecido/não aplicável" — nunca confundir com zero/string vazia
 * (ex.: `totalCost: null` = nenhum exemplar tem custo conhecido, nunca
 * custo real R$0).
 */
export interface CollectionExportRow {
  country: string | null
  year: number | null
  denomination: string | null
  mint: string | null
  labelCode: string | null
  quantity: number
  metal: string | null
  secondaryMetal: string | null
  grossWeightG: number | null
  purity: number | null
  faceValue: number | null
  mintage: string | null
  purchaseDate: string | null
  seller: string | null
  location: string | null
  notes: string | null
  totalCost: number | null
  costPerUnit: number | null
  /** Já traduzido para PT-BR (mesma tradução para qualquer formato de saída) — `null` quando os exemplares não têm custo uniforme (evita atribuir uma origem só ao item inteiro, ver `getItemAcquisitionSummary`). */
  costOrigin: string | null
  costType: string | null
  grade: string | null
  gradeScale: string | null
  /** Já traduzido para PT-BR via `COLLECTION_UNIT_STATUS_LABELS`. */
  status: string | null
  rating: number | null
  isPrimary: boolean | null
  description: string | null
  tags: string[]
  history: string | null
  trivia: string | null
  catalogReferences: CatalogReference[]
  createdAt: string
}

function buildExportRow(item: CollectionItem): CollectionExportRow {
  const summary = getItemAcquisitionSummary(item)
  const primaryUnit = getPrimaryUnit(item)
  // "Nenhum exemplar tem custo conhecido" (nunca confundir com custo real
  // R$0) — mesma distinção já usada por `getItemAcquisitionSummary` em
  // toda a UI de Coleção.
  const hasKnownCost = !(summary.isUniform && summary.uniformCost === null)

  return {
    country: item.countryDisplayName,
    year: item.year,
    denomination: item.denomination,
    mint: item.mint,
    labelCode: item.labelCode,
    quantity: item.quantity,
    metal: item.metalName,
    secondaryMetal: item.secondaryMetalName,
    grossWeightG: item.grossWeightG,
    purity: item.purity,
    faceValue: item.faceValue,
    mintage: item.mintage,
    purchaseDate: item.purchase?.purchaseDate ?? null,
    seller: item.purchase?.sellerName ?? null,
    location: item.location,
    notes: item.purchase?.notes ?? null,
    totalCost: hasKnownCost ? summary.totalInvested : null,
    costPerUnit: hasKnownCost ? summary.averageCost : null,
    // Origem/tipo do custo só fazem sentido como UM valor quando todos os
    // exemplares do item compartilham o mesmo custo (isUniform) — do
    // contrário, atribuir a origem só do exemplar principal ao item
    // inteiro seria enganoso.
    costOrigin: summary.isUniform && primaryUnit ? COST_ORIGIN_LABELS[primaryUnit.costOrigin] : null,
    costType: summary.isUniform && primaryUnit ? COST_TYPE_LABELS[primaryUnit.costType] : null,
    grade: primaryUnit?.gradeLabel ?? null,
    gradeScale: primaryUnit?.gradeScale ?? null,
    status: primaryUnit ? COLLECTION_UNIT_STATUS_LABELS[primaryUnit.status] : null,
    rating: primaryUnit?.rating ?? null,
    isPrimary: primaryUnit?.isPrimary ?? null,
    description: item.description,
    tags: item.tags ?? [],
    history: item.history,
    trivia: item.trivia,
    catalogReferences: item.catalogReferences ?? [],
    createdAt: item.createdAt,
  }
}

/**
 * Único ponto de transformação `CollectionItem[]` → modelo exportável.
 * CSV/XLSX/PDF (quando existir) consomem SEMPRE a partir daqui, nunca de
 * `CollectionItem` diretamente — evita duplicar a lógica de "o que é
 * exportável e como" em cada formato de saída.
 */
export function buildCollectionExportModel(items: CollectionItem[]): CollectionExportRow[] {
  return items.map(buildExportRow)
}

export interface DistributionEntry {
  label: string
  count: number
}

/**
 * Etapa "5.10V.2 — Excel Premium": indicadores/distribuições para a aba
 * "Resumo" — deliberadamente calculados a partir do MODELO (nunca de
 * `CollectionItem[]` direto), para que um futuro PDF (mesma seção
 * "Resumo") reutilize esta função sem duplicar a lógica.
 *
 * "Total de itens" = 1 linha do modelo = 1 `collection_item` (uma
 * emissão). "Total de exemplares" = soma de `quantity` (Etapa 5.10V,
 * `collection_items.quantity` já é o espelho de `COUNT(collection_units)`
 * — mesma semântica de `totalItems`/`totalUnits` já usada no Dashboard,
 * nunca confundir as duas).
 *
 * Distribuição por país/metal: contada por ITEM (mesma convenção já
 * estabelecida em `lib/stats/collection-stats.ts`,
 * `computeCountryDistribution`/`computeMetalDistribution` — "país/metal é
 * atributo da emissão, não do exemplar"). Distribuição por status: como o
 * modelo tem grão de 1 linha por item, reflete o status do EXEMPLAR
 * PRINCIPAL de cada item (mesma limitação documentada em
 * `CollectionExportRow.status`) — não é uma contagem por exemplar.
 *
 * `totalKnownCost`: `null` quando NENHUM item tem custo conhecido — nunca
 * mostrado como "0" (auditoria 5.10V, "se não for seguro apresentar,
 * omitir"). Nunca soma valores como se fossem a mesma moeda "convertida"
 * — é uma soma bruta de números, sem símbolo de moeda, mesma decisão já
 * tomada para `CollectionExportRow.totalCost`/`costPerUnit`.
 */
export interface CollectionExportSummary {
  totalItems: number
  totalUnits: number
  countriesRepresented: number
  yearsRepresented: number
  /** Itens com `purchaseDate` conhecido — nunca "compras distintas" (o modelo não preserva purchase_id, de propósito, ver auditoria 5.10T). */
  registeredPurchases: number
  /** ISO `YYYY-MM-DD`, `null` quando nenhum item tem data de compra. */
  firstAcquisitionDate: string | null
  lastAcquisitionDate: string | null
  /** `null` = nenhum item da coleção tem custo conhecido — nunca confundir com custo total real 0. */
  totalKnownCost: number | null
  countryDistribution: DistributionEntry[]
  metalDistribution: DistributionEntry[]
  statusDistribution: DistributionEntry[]
  decadeDistribution: DistributionEntry[]
}

function countBy(rows: CollectionExportRow[], pick: (row: CollectionExportRow) => string | null): DistributionEntry[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = pick(row)
    if (key === null) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function decadeLabel(year: number): string {
  const decade = Math.floor(year / 10) * 10
  return `Década de ${decade}`
}

export function computeCollectionExportSummary(rows: CollectionExportRow[]): CollectionExportSummary {
  const purchaseDates = rows.map((row) => row.purchaseDate).filter((date): date is string => date !== null)
  const knownCosts = rows.map((row) => row.totalCost).filter((cost): cost is number => cost !== null)

  return {
    totalItems: rows.length,
    totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    countriesRepresented: new Set(rows.map((row) => row.country).filter((c): c is string => c !== null)).size,
    yearsRepresented: new Set(rows.map((row) => row.year).filter((y): y is number => y !== null)).size,
    registeredPurchases: purchaseDates.length,
    // Comparação lexicográfica de strings ISO "YYYY-MM-DD" é seguramente
    // ordenável cronologicamente (mesmo truque já usado em outras partes
    // do projeto para datas ISO) — nunca precisa virar `Date` para isso.
    firstAcquisitionDate: purchaseDates.length === 0 ? null : purchaseDates.reduce((min, d) => (d < min ? d : min)),
    lastAcquisitionDate: purchaseDates.length === 0 ? null : purchaseDates.reduce((max, d) => (d > max ? d : max)),
    totalKnownCost: knownCosts.length === 0 ? null : knownCosts.reduce((sum, cost) => sum + cost, 0),
    countryDistribution: countBy(rows, (row) => row.country),
    metalDistribution: countBy(rows, (row) => row.metal),
    statusDistribution: countBy(rows, (row) => row.status),
    decadeDistribution: countBy(rows, (row) => (row.year === null ? null : decadeLabel(row.year))),
  }
}
