/**
 * lib/stripe/catalog.ts
 * Etapa "Stripe 4.1A" — leitura (só leitura) do catálogo comercial em
 * `plan_prices`, para a futura sincronização com o Stripe (Stripe 4.1B).
 * O banco é a ÚNICA fonte dos valores comerciais — nenhum amount/currency/
 * interval é hardcoded aqui; a validação abaixo só confere a FORMA dos
 * dados que já existem (Stripe 0-3.5), nunca inventa nem corrige um valor.
 *
 * `free` nunca aparece no resultado — Free não tem Stripe Product/Price
 * (regra de negócio já fixada desde a Stripe 2/3).
 *
 * A validação (`parseCommercialPlanPriceRow`/`assertNoDuplicateCombinations`)
 * é separada da leitura (`getCommercialPlanPricesCatalog`) de propósito —
 * a primeira é pura (testável com linhas fabricadas, sem tocar o banco), a
 * segunda é a única parte que efetivamente consulta o Supabase.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type PaidPlanSlug = 'pro' | 'premium'
export type PriceInterval = 'month' | 'year'
export type PriceCurrency = 'BRL' | 'USD'

const PAID_PLAN_SLUGS: readonly PaidPlanSlug[] = ['pro', 'premium']
const VALID_INTERVALS: readonly PriceInterval[] = ['month', 'year']
const VALID_CURRENCIES: readonly PriceCurrency[] = ['BRL', 'USD']

export interface CommercialPlanPrice {
  /** `plan_prices.id` — usado para gravar `stripe_price_id`/`active` de volta na linha exata (nunca por plan+interval+currency). */
  planPriceId: string
  planId: string
  planSlug: PaidPlanSlug
  interval: PriceInterval
  currency: PriceCurrency
  /** Valor comercial "de unidade inteira" (ex.: 19.90), como está no banco — nunca minor units aqui (ver `toStripeMinorUnits`). */
  amount: number
  stripePriceId: string | null
  active: boolean
}

/** Forma já achatada (plan slug resolvido) — desacoplada do formato de join do Supabase, para ser fabricável em teste sem precisar simular a resposta da API. */
export interface RawCommercialPlanPriceRow {
  id: string
  planId: string
  planSlug: string | null
  interval: string
  currency: string
  amount: number | string
  stripePriceId: string | null
  active: boolean
}

function isPaidPlanSlug(slug: string | null): slug is PaidPlanSlug {
  return slug !== null && (PAID_PLAN_SLUGS as readonly string[]).includes(slug)
}

function isValidInterval(value: string): value is PriceInterval {
  return (VALID_INTERVALS as readonly string[]).includes(value)
}

function isValidCurrency(value: string): value is PriceCurrency {
  return (VALID_CURRENCIES as readonly string[]).includes(value)
}

/**
 * Valida uma única linha e a converte para `CommercialPlanPrice`. Lança um
 * erro descritivo na primeira inconsistência — nunca ignora/pula
 * silenciosamente uma linha inválida, nunca corrige um valor sozinha.
 * Pura — nenhum acesso a rede/banco.
 */
export function parseCommercialPlanPriceRow(row: RawCommercialPlanPriceRow): CommercialPlanPrice {
  if (!isPaidPlanSlug(row.planSlug)) {
    throw new Error(`[parseCommercialPlanPriceRow] plan_price ${row.id} não pertence a um plano pago conhecido (slug: ${row.planSlug ?? 'null'}).`)
  }
  if (!isValidInterval(row.interval)) {
    throw new Error(`[parseCommercialPlanPriceRow] plan_price ${row.id} tem interval inválido: "${row.interval}".`)
  }
  if (!isValidCurrency(row.currency)) {
    throw new Error(`[parseCommercialPlanPriceRow] plan_price ${row.id} tem currency inválida: "${row.currency}".`)
  }

  const amount = typeof row.amount === 'string' ? Number(row.amount) : row.amount
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`[parseCommercialPlanPriceRow] plan_price ${row.id} tem amount inválido: ${row.amount}.`)
  }

  if (row.active && !row.stripePriceId) {
    // Defesa em profundidade — o banco já impede isso via
    // chk_plan_prices_active_requires_stripe_price (Stripe 3.2); esta
    // checagem nunca deveria disparar na prática.
    throw new Error(`[parseCommercialPlanPriceRow] plan_price ${row.id} está active=true mas sem stripePriceId — estado impossível.`)
  }
  if (row.stripePriceId !== null && row.stripePriceId.trim().length === 0) {
    throw new Error(`[parseCommercialPlanPriceRow] plan_price ${row.id} tem stripePriceId vazio (deveria ser null ou um ID real).`)
  }

  return {
    planPriceId: row.id,
    planId: row.planId,
    planSlug: row.planSlug,
    interval: row.interval,
    currency: row.currency,
    amount,
    stripePriceId: row.stripePriceId,
    active: row.active,
  }
}

/** Lança se houver mais de uma linha para a mesma combinação plano+intervalo+moeda. Pura. */
export function assertNoDuplicateCombinations(rows: CommercialPlanPrice[]): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.planSlug}:${row.interval}:${row.currency}`
    if (seen.has(key)) {
      throw new Error(`[assertNoDuplicateCombinations] combinação duplicada encontrada para ${key} — esperado no máximo uma linha corrente por plano+intervalo+moeda.`)
    }
    seen.add(key)
  }
}

interface PlanPriceQueryRow {
  id: string
  plan_id: string
  interval: string
  currency: string
  amount: number | string
  stripe_price_id: string | null
  active: boolean
  plans: { slug: string } | { slug: string }[] | null
}

function resolvePlanSlug(plans: PlanPriceQueryRow['plans']): string | null {
  if (!plans) return null
  return Array.isArray(plans) ? (plans[0]?.slug ?? null) : plans.slug
}

/**
 * Lê e valida o catálogo comercial (só planos pagos — Free é excluído pela
 * própria query).
 *
 * Filtra `effective_until IS NULL` — a versão "corrente" de cada
 * combinação (vendável ou ainda rascunho, tanto faz), nunca uma versão já
 * superada por um reajuste futuro. Sem esse filtro, depois que o
 * versionamento (Stripe 3.2) acumular histórico de verdade, a mesma
 * combinação teria mais de uma linha e `assertNoDuplicateCombinations`
 * dispararia incorretamente contra dado histórico legítimo.
 */
export async function getCommercialPlanPricesCatalog(supabase: SupabaseClient): Promise<CommercialPlanPrice[]> {
  const { data, error } = await supabase
    .from('plan_prices')
    .select('id, plan_id, interval, currency, amount, stripe_price_id, active, plans!inner(slug)')
    .in('plans.slug', PAID_PLAN_SLUGS)
    .is('effective_until', null)

  if (error) {
    throw new Error(`[getCommercialPlanPricesCatalog] Falha ao ler plan_prices: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as PlanPriceQueryRow[]
  const parsed = rows.map((row) =>
    parseCommercialPlanPriceRow({
      id: row.id,
      planId: row.plan_id,
      planSlug: resolvePlanSlug(row.plans),
      interval: row.interval,
      currency: row.currency,
      amount: row.amount,
      stripePriceId: row.stripe_price_id,
      active: row.active,
    }),
  )

  assertNoDuplicateCombinations(parsed)

  return parsed
}
