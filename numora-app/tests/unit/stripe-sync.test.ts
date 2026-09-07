/**
 * tests/unit/stripe-sync.test.ts
 * Etapa "Stripe 4.1A" — `recordStripePriceSync`/`activateSyncedPrice`
 * (lib/stripe/sync.ts), testadas com um client Supabase MOCKADO — nenhuma
 * escrita real acontece contra DEV (regra explícita desta etapa: "ZERO
 * escrita de billing em DEV"). Confirma só a FORMA da chamada (tabela,
 * payload, filtro) e a propagação de erro.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { activateSyncedPrice, recordStripePriceSync } from '@/lib/stripe/sync'

function makeMockSupabase(eqResult: { error: { message: string } | null }) {
  const eq = vi.fn().mockResolvedValue(eqResult)
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { client: { from } as unknown as SupabaseClient, from, update, eq }
}

describe('recordStripePriceSync', () => {
  it('grava stripe_price_id na linha exata (por id), nunca active', async () => {
    const { client, from, update, eq } = makeMockSupabase({ error: null })

    await recordStripePriceSync(client, 'plan-price-uuid', 'price_abc123')

    expect(from).toHaveBeenCalledWith('plan_prices')
    expect(update).toHaveBeenCalledWith({ stripe_price_id: 'price_abc123' })
    expect(eq).toHaveBeenCalledWith('id', 'plan-price-uuid')
  })

  it('propaga erro do Supabase com contexto', async () => {
    const { client } = makeMockSupabase({ error: { message: 'falha simulada' } })

    await expect(recordStripePriceSync(client, 'plan-price-uuid', 'price_abc123')).rejects.toThrow(/falha simulada/)
  })
})

describe('activateSyncedPrice', () => {
  it('só altera active=true, nunca stripe_price_id', async () => {
    const { client, from, update, eq } = makeMockSupabase({ error: null })

    await activateSyncedPrice(client, 'plan-price-uuid')

    expect(from).toHaveBeenCalledWith('plan_prices')
    expect(update).toHaveBeenCalledWith({ active: true })
    expect(eq).toHaveBeenCalledWith('id', 'plan-price-uuid')
  })

  it('propaga erro do Supabase com contexto', async () => {
    const { client } = makeMockSupabase({ error: { message: 'falha simulada' } })

    await expect(activateSyncedPrice(client, 'plan-price-uuid')).rejects.toThrow(/falha simulada/)
  })
})
