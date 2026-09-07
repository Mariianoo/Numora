/**
 * lib/stripe/identity.ts
 * Etapa "Stripe 4.1A" — identidade determinística de Products/Prices no
 * Stripe, para a futura sincronização (Stripe 4.1B). Nada aqui chama o
 * Stripe — só define os identificadores/metadata que a criação futura vai
 * usar, e que a busca por idempotência (`lib/stripe/idempotency.ts`) vai
 * comparar contra o que já existir.
 *
 * Product não tem `lookup_key` no Stripe (só Price tem) — por isso a
 * identidade de Product é só metadata (`numora_plan_slug`); a de Price
 * combina `lookup_key` (determinístico, pesquisável nativamente pela API
 * do Stripe) + metadata (contexto de auditoria/reconciliação).
 */
import type { CommercialPlanPrice, PaidPlanSlug } from './catalog'

/** Nome legível do Product — nunca usado para identificação/busca (metadata cumpre esse papel). */
export const PRODUCT_NAMES: Record<PaidPlanSlug, string> = {
  pro: 'Numora Pro',
  premium: 'Numora Premium',
}

export interface ProductMetadata {
  numora_plan_slug: PaidPlanSlug
}

export function getProductMetadata(planSlug: PaidPlanSlug): ProductMetadata {
  return { numora_plan_slug: planSlug }
}

/** Ex.: "numora_pro_brl_month" — determinístico a partir de plan+currency+interval, nunca um valor arbitrário/sequencial. */
export function getPriceLookupKey(planSlug: PaidPlanSlug, currency: string, interval: string): string {
  return `numora_${planSlug}_${currency.toLowerCase()}_${interval.toLowerCase()}`
}

export interface PriceMetadata {
  numora_plan_price_id: string
  numora_plan_slug: PaidPlanSlug
  numora_interval: string
  numora_currency: string
}

export function getPriceMetadata(row: CommercialPlanPrice): PriceMetadata {
  return {
    numora_plan_price_id: row.planPriceId,
    numora_plan_slug: row.planSlug,
    numora_interval: row.interval,
    numora_currency: row.currency,
  }
}
