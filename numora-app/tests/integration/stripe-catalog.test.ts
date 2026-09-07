/**
 * tests/integration/stripe-catalog.test.ts
 * Etapa "Stripe 4.1A" — `getCommercialPlanPricesCatalog`
 * (lib/stripe/catalog.ts) contra Supabase DEV real. SÓ LEITURA — nenhuma
 * escrita, nenhum dado criado/alterado/removido. Confirma exatamente os 8
 * preços comerciais reais (Stripe 3) e que Free nunca aparece.
 */
import { describe, expect, it } from 'vitest'

import { createAdminClient, getTestEnv, hasTestEnv } from '../support/dev-env'
import { getCommercialPlanPricesCatalog } from '@/lib/stripe/catalog'

const EXPECTED_AMOUNTS: Record<string, number> = {
  'pro:month:BRL': 19.9,
  'pro:year:BRL': 199.0,
  'pro:month:USD': 5.99,
  'pro:year:USD': 59.0,
  'premium:month:BRL': 34.9,
  'premium:year:BRL': 349.0,
  'premium:month:USD': 9.99,
  'premium:year:USD': 99.0,
}

describe.skipIf(!hasTestEnv())('getCommercialPlanPricesCatalog (DEV real, só leitura)', () => {
  it('lê exatamente os 8 preços comerciais reais (Pro/Premium × month/year × BRL/USD)', async () => {
    const env = getTestEnv()!
    const admin = createAdminClient(env)

    const catalog = await getCommercialPlanPricesCatalog(admin)

    expect(catalog).toHaveLength(8)

    const byKey = Object.fromEntries(catalog.map((row) => [`${row.planSlug}:${row.interval}:${row.currency}`, row.amount]))
    expect(byKey).toEqual(EXPECTED_AMOUNTS)

    for (const row of catalog) {
      expect(row.active).toBe(false)
      expect(row.stripePriceId).toBeNull()
      expect(['pro', 'premium']).toContain(row.planSlug)
    }
  })

  it('Free nunca aparece no catálogo comercial', async () => {
    const env = getTestEnv()!
    const admin = createAdminClient(env)

    const catalog = await getCommercialPlanPricesCatalog(admin)

    expect(catalog.every((row) => (row.planSlug as string) !== 'free')).toBe(true)
  })
})
