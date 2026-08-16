/**
 * lib/stats/collection-stats.ts
 * Cálculo de estatísticas da coleção — extraído de app/dashboard/page.tsx
 * (Etapa 8.1) para ser reutilizado por app/dashboard/profile/page.tsx sem
 * duplicar a lógica nem alterar o comportamento do Dashboard.
 *
 * Função pura, sem dependência de Supabase — quem busca os dados decide a
 * origem (Dashboard: Server Component com client de servidor; Perfil:
 * ProfileRepository com client de browser). `total investido` soma
 * `purchases.total_price` diretamente (não deriva de collection_items),
 * de propósito: um item pode compartilhar `purchase_id` com outro
 * (aquisição em lote), então somar pelo lado de `collection_items`
 * contaria a mesma compra mais de uma vez.
 *
 * Etapa 13.1 (Dashboard 2.0 — dados 🟢 da auditoria da Etapa 13): adiciona
 * valor médio de aquisição e distribuições (país/metal/conservação/status),
 * sem alterar `computeCollectionStats`/`CollectionItemStatsRow` — o Perfil
 * (`ProfileRepository.getOwnStats`) continua chamando exatamente a mesma
 * função com a mesma query enxuta de sempre. As novas funções vivem no
 * mesmo arquivo (mesma camada), nunca um pipeline de stats paralelo.
 */
import { COLLECTION_UNIT_STATUS_EMOJI, COLLECTION_UNIT_STATUS_LABELS } from '@/features/collection-units/types'
import type { CollectionUnitStatus } from '@/features/collection-units/types'

export interface CollectionItemStatsRow {
  quantity: number
  country_code: string | null
  metal_code: string | null
}

export interface PurchaseStatsRow {
  total_price: number
}

export interface CollectionStats {
  totalItems: number
  totalUnits: number
  countryCount: number
  metalCount: number
  totalInvested: number
}

export function computeCollectionStats(
  items: CollectionItemStatsRow[],
  purchases: PurchaseStatsRow[],
): CollectionStats {
  return {
    totalItems: items.length,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    countryCount: new Set(items.map((item) => item.country_code).filter((code): code is string => code !== null))
      .size,
    metalCount: new Set(items.map((item) => item.metal_code).filter((code): code is string => code !== null)).size,
    totalInvested: purchases.reduce((sum, purchase) => sum + Number(purchase.total_price), 0),
  }
}

/**
 * `null` quando não há exemplares (nunca divide por zero) — a UI decide
 * como representar "sem dado" (ex.: "—"), nunca "R$ 0,00" (que sugeriria
 * custo real zero, não ausência de dado).
 */
export function computeAverageAcquisitionCost(totalInvested: number, totalUnits: number): number | null {
  if (totalUnits <= 0) return null
  return totalInvested / totalUnits
}

export interface DistributionEntry {
  key: string
  label: string
  count: number
  /** Emoji/bandeira exibido antes do label, quando aplicável. */
  prefix?: string
}

/**
 * Top-N por contagem decrescente + um bucket final "Outros" com o
 * restante somado — nunca descarta dados silenciosamente (auditoria,
 * Etapa 13 §13). `maxEntries` inclui o próprio bucket "Outros" quando ele
 * existe, então o número de barras exibidas nunca passa desse limite.
 */
function bucketDistribution(
  entries: DistributionEntry[],
  maxEntries: number,
  othersLabel: string,
): DistributionEntry[] {
  const sorted = [...entries].sort((a, b) => b.count - a.count)
  if (sorted.length <= maxEntries) return sorted

  const visible = sorted.slice(0, maxEntries - 1)
  const rest = sorted.slice(maxEntries - 1)
  const othersCount = rest.reduce((sum, entry) => sum + entry.count, 0)
  return [...visible, { key: '__others__', label: `${othersLabel} (${rest.length})`, count: othersCount }]
}

const MAX_COUNTRY_ENTRIES = 6
const MAX_METAL_ENTRIES = 6
const MAX_GRADE_ENTRIES = 6

export interface CollectionItemDistributionRow {
  country_code: string | null
  country_name: string | null
  country_flag_emoji: string | null
  metal_code: string | null
  metal_name: string | null
}

/** Conta por MOEDA (collection_item) — país é atributo da emissão, não do exemplar. */
export function computeCountryDistribution(items: CollectionItemDistributionRow[]): DistributionEntry[] {
  const counts = new Map<string, DistributionEntry>()
  for (const item of items) {
    if (item.country_code === null) continue
    const existing = counts.get(item.country_code)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(item.country_code, {
        key: item.country_code,
        label: item.country_name ?? item.country_code,
        prefix: item.country_flag_emoji ?? undefined,
        count: 1,
      })
    }
  }
  return bucketDistribution(Array.from(counts.values()), MAX_COUNTRY_ENTRIES, 'Outros')
}

/** Conta por MOEDA (collection_item) — metal é atributo da emissão, não do exemplar. */
export function computeMetalDistribution(items: CollectionItemDistributionRow[]): DistributionEntry[] {
  const counts = new Map<string, DistributionEntry>()
  for (const item of items) {
    if (item.metal_code === null) continue
    const existing = counts.get(item.metal_code)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(item.metal_code, { key: item.metal_code, label: item.metal_name ?? item.metal_code, count: 1 })
    }
  }
  return bucketDistribution(Array.from(counts.values()), MAX_METAL_ENTRIES, 'Outros')
}

export interface CollectionUnitDistributionRow {
  status: string
  grade_id: string | null
  grade_label: string | null
}

const NO_GRADE_KEY = '__no_grade__'

/**
 * Conta por EXEMPLAR (collection_unit) — conservação é do exemplar físico,
 * nunca da emissão. Agrupa por `grade_id` (não por texto do label): o
 * catálogo real de `grades` tem rótulos repetidos entre escalas diferentes
 * (ex.: duas entradas "Very Fine" com ids distintos) — agrupar por texto
 * fundiria conservações diferentes por coincidência de nome.
 */
export function computeGradeDistribution(units: CollectionUnitDistributionRow[]): DistributionEntry[] {
  const counts = new Map<string, DistributionEntry>()
  for (const unit of units) {
    const key = unit.grade_id ?? NO_GRADE_KEY
    const existing = counts.get(key)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(key, { key, label: unit.grade_label ?? 'Não informada', count: 1 })
    }
  }
  return bucketDistribution(Array.from(counts.values()), MAX_GRADE_ENTRIES, 'Outras')
}

/**
 * Conta por EXEMPLAR (collection_unit). Só inclui status realmente
 * presentes (nunca os 6 fixos com zero) — mesmo critério de "não mostrar
 * gráfico vazio sem contexto" aplicado por status individual. Labels/
 * emojis vêm de `COLLECTION_UNIT_STATUS_LABELS`/`_EMOJI`, nunca duplicados
 * aqui.
 */
export function computeStatusDistribution(units: { status: string }[]): DistributionEntry[] {
  const counts = new Map<CollectionUnitStatus, number>()
  for (const unit of units) {
    const status = unit.status as CollectionUnitStatus
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({
      key: status,
      label: COLLECTION_UNIT_STATUS_LABELS[status] ?? status,
      prefix: COLLECTION_UNIT_STATUS_EMOJI[status],
      count,
    }))
    .sort((a, b) => b.count - a.count)
}
