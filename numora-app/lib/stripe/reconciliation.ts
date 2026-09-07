/**
 * lib/stripe/reconciliation.ts
 * Etapa "Stripe 4.1A" — comparação entre um `plan_prices` local e um
 * Stripe Price já existente (encontrado via `resolveExistingPrice`), para
 * detectar configuração incompatível ANTES de reutilizar o ID.
 *
 * Função pura — recebe um snapshot já obtido do Stripe (a futura Stripe
 * 4.1B monta esse snapshot a partir da resposta real da API); nenhuma
 * chamada ao Stripe acontece aqui.
 *
 * Regra absoluta: se o `lookup_key` já existir mas a configuração não
 * bater (produto errado, moeda errada, valor errado, intervalo errado,
 * metadata divergente), a futura sincronização deve PARAR com erro —
 * nunca sobrescrever silenciosamente um Price existente (Prices do Stripe
 * são imutáveis mesmo, então "corrigir" significaria arquivar e criar
 * outro — uma decisão que exige intervenção humana, não algo que esta
 * função decide sozinha).
 */
import type { CommercialPlanPrice } from './catalog'
import { getPriceLookupKey, getPriceMetadata } from './identity'
import { toStripeMinorUnits } from './minor-units'

export interface StripePriceSnapshot {
  id: string
  productId: string
  currency: string
  unitAmount: number
  interval: string
  lookupKey: string | null
  metadata: Record<string, string | undefined>
}

export interface ReconciliationResult {
  matches: boolean
  mismatches: string[]
}

export function reconcilePriceWithStripe(local: CommercialPlanPrice, expectedProductId: string, stripePrice: StripePriceSnapshot): ReconciliationResult {
  const mismatches: string[] = []

  const expectedLookupKey = getPriceLookupKey(local.planSlug, local.currency, local.interval)
  if (stripePrice.lookupKey !== expectedLookupKey) {
    mismatches.push(`lookup_key: esperado "${expectedLookupKey}", encontrado "${stripePrice.lookupKey ?? 'null'}"`)
  }

  if (stripePrice.productId !== expectedProductId) {
    mismatches.push(`product: esperado "${expectedProductId}", encontrado "${stripePrice.productId}"`)
  }

  if (stripePrice.currency.toUpperCase() !== local.currency) {
    mismatches.push(`currency: esperado "${local.currency}", encontrado "${stripePrice.currency}"`)
  }

  const expectedMinorUnits = toStripeMinorUnits(local.amount)
  if (stripePrice.unitAmount !== expectedMinorUnits) {
    mismatches.push(`unit_amount: esperado ${expectedMinorUnits}, encontrado ${stripePrice.unitAmount}`)
  }

  if (stripePrice.interval !== local.interval) {
    mismatches.push(`interval: esperado "${local.interval}", encontrado "${stripePrice.interval}"`)
  }

  const expectedMetadata = getPriceMetadata(local)
  for (const [key, expectedValue] of Object.entries(expectedMetadata)) {
    const actualValue = stripePrice.metadata[key]
    if (actualValue !== expectedValue) {
      mismatches.push(`metadata.${key}: esperado "${expectedValue}", encontrado "${actualValue ?? 'ausente'}"`)
    }
  }

  return { matches: mismatches.length === 0, mismatches }
}

/** Mesma comparação, mas lança se houver qualquer divergência — "pare com erro", nunca sobrescreva silenciosamente. */
export function assertPriceReconciled(local: CommercialPlanPrice, expectedProductId: string, stripePrice: StripePriceSnapshot): void {
  const result = reconcilePriceWithStripe(local, expectedProductId, stripePrice)
  if (!result.matches) {
    throw new Error(
      `[assertPriceReconciled] Stripe Price ${stripePrice.id} já existe com o mesmo lookup_key, mas configuração incompatível:\n` +
        result.mismatches.map((mismatch) => `  - ${mismatch}`).join('\n'),
    )
  }
}
