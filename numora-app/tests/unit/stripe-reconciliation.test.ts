/**
 * tests/unit/stripe-reconciliation.test.ts
 * Etapa "Stripe 4.1A" — `reconcilePriceWithStripe`/`assertPriceReconciled`
 * (lib/stripe/reconciliation.ts). Snapshot do Stripe fabricado — nenhuma
 * chamada real.
 */
import { describe, expect, it } from 'vitest'

import { assertPriceReconciled, reconcilePriceWithStripe, type StripePriceSnapshot } from '@/lib/stripe/reconciliation'
import type { CommercialPlanPrice } from '@/lib/stripe/catalog'

const LOCAL: CommercialPlanPrice = {
  planPriceId: 'plan-price-uuid',
  planId: 'plan-uuid',
  planSlug: 'pro',
  interval: 'month',
  currency: 'BRL',
  amount: 19.9,
  stripePriceId: 'price_existing',
  active: true,
}

function makeMatchingSnapshot(): StripePriceSnapshot {
  return {
    id: 'price_existing',
    productId: 'prod_numora_pro',
    currency: 'brl',
    unitAmount: 1990,
    interval: 'month',
    lookupKey: 'numora_pro_brl_month',
    metadata: {
      numora_plan_price_id: 'plan-price-uuid',
      numora_plan_slug: 'pro',
      numora_interval: 'month',
      numora_currency: 'BRL',
    },
  }
}

describe('reconcilePriceWithStripe', () => {
  it('matches=true quando tudo bate (currency é comparada case-insensitive)', () => {
    const result = reconcilePriceWithStripe(LOCAL, 'prod_numora_pro', makeMatchingSnapshot())
    expect(result).toEqual({ matches: true, mismatches: [] })
  })

  it('detecta lookup_key incompatível', () => {
    const snapshot = { ...makeMatchingSnapshot(), lookupKey: 'algo_errado' }
    const result = reconcilePriceWithStripe(LOCAL, 'prod_numora_pro', snapshot)
    expect(result.matches).toBe(false)
    expect(result.mismatches.some((m) => m.startsWith('lookup_key'))).toBe(true)
  })

  it('detecta product incompatível', () => {
    const snapshot = makeMatchingSnapshot()
    const result = reconcilePriceWithStripe(LOCAL, 'prod_outro', snapshot)
    expect(result.matches).toBe(false)
    expect(result.mismatches.some((m) => m.startsWith('product'))).toBe(true)
  })

  it('detecta unit_amount incompatível', () => {
    const snapshot = { ...makeMatchingSnapshot(), unitAmount: 2000 }
    const result = reconcilePriceWithStripe(LOCAL, 'prod_numora_pro', snapshot)
    expect(result.matches).toBe(false)
    expect(result.mismatches.some((m) => m.startsWith('unit_amount'))).toBe(true)
  })

  it('detecta interval incompatível', () => {
    const snapshot = { ...makeMatchingSnapshot(), interval: 'year' }
    const result = reconcilePriceWithStripe(LOCAL, 'prod_numora_pro', snapshot)
    expect(result.matches).toBe(false)
    expect(result.mismatches.some((m) => m.startsWith('interval'))).toBe(true)
  })

  it('detecta metadata divergente', () => {
    const snapshot = { ...makeMatchingSnapshot(), metadata: { ...makeMatchingSnapshot().metadata, numora_plan_slug: 'premium' } }
    const result = reconcilePriceWithStripe(LOCAL, 'prod_numora_pro', snapshot)
    expect(result.matches).toBe(false)
    expect(result.mismatches.some((m) => m.startsWith('metadata.numora_plan_slug'))).toBe(true)
  })
})

describe('assertPriceReconciled', () => {
  it('não lança quando tudo bate', () => {
    expect(() => assertPriceReconciled(LOCAL, 'prod_numora_pro', makeMatchingSnapshot())).not.toThrow()
  })

  it('lança (pare com erro) quando há qualquer divergência — nunca sobrescreve silenciosamente', () => {
    const snapshot = { ...makeMatchingSnapshot(), unitAmount: 2490 }
    expect(() => assertPriceReconciled(LOCAL, 'prod_numora_pro', snapshot)).toThrow(/configuração incompatível/)
  })
})
