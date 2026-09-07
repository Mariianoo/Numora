/**
 * tests/unit/stripe-identity.test.ts
 * Etapa "Stripe 4.1A" — identidade determinística (lib/stripe/identity.ts).
 * Confirma exatamente os 8 lookup_keys e a metadata pedidos na etapa.
 */
import { describe, expect, it } from 'vitest'

import { getPriceLookupKey, getPriceMetadata, getProductMetadata, PRODUCT_NAMES } from '@/lib/stripe/identity'
import type { CommercialPlanPrice } from '@/lib/stripe/catalog'

describe('getProductMetadata', () => {
  it('produz metadata determinística para pro/premium', () => {
    expect(getProductMetadata('pro')).toEqual({ numora_plan_slug: 'pro' })
    expect(getProductMetadata('premium')).toEqual({ numora_plan_slug: 'premium' })
  })

  it('nomes legíveis dos Products', () => {
    expect(PRODUCT_NAMES.pro).toBe('Numora Pro')
    expect(PRODUCT_NAMES.premium).toBe('Numora Premium')
  })
})

describe('getPriceLookupKey', () => {
  it.each([
    ['pro', 'BRL', 'month', 'numora_pro_brl_month'],
    ['pro', 'BRL', 'year', 'numora_pro_brl_year'],
    ['pro', 'USD', 'month', 'numora_pro_usd_month'],
    ['pro', 'USD', 'year', 'numora_pro_usd_year'],
    ['premium', 'BRL', 'month', 'numora_premium_brl_month'],
    ['premium', 'BRL', 'year', 'numora_premium_brl_year'],
    ['premium', 'USD', 'month', 'numora_premium_usd_month'],
    ['premium', 'USD', 'year', 'numora_premium_usd_year'],
  ] as const)('%s/%s/%s → %s', (planSlug, currency, interval, expected) => {
    expect(getPriceLookupKey(planSlug, currency, interval)).toBe(expected)
  })

  it('é determinística — a mesma entrada sempre produz a mesma chave', () => {
    expect(getPriceLookupKey('pro', 'BRL', 'month')).toBe(getPriceLookupKey('pro', 'BRL', 'month'))
  })
})

describe('getPriceMetadata', () => {
  it('inclui plan_price_id, plan_slug, interval e currency', () => {
    const row: CommercialPlanPrice = {
      planPriceId: 'uuid-123',
      planId: 'plan-uuid-456',
      planSlug: 'pro',
      interval: 'month',
      currency: 'BRL',
      amount: 19.9,
      stripePriceId: null,
      active: false,
    }
    expect(getPriceMetadata(row)).toEqual({
      numora_plan_price_id: 'uuid-123',
      numora_plan_slug: 'pro',
      numora_interval: 'month',
      numora_currency: 'BRL',
    })
  })
})
