/**
 * tests/integration/plan-prices-catalog.test.ts
 * Etapa "Stripe 3 — Catálogo comercial no banco" — prova, contra Supabase
 * DEV real, que a migration `20260905120000_seed_commercial_plan_prices.sql`
 * populou exatamente os 8 preços comerciais aprovados (Pro/Premium ×
 * month/year × BRL/USD) e que `plan_prices.currency` está restrita a
 * BRL/USD.
 *
 * Atualizado na Etapa "Stripe 4.1B.1": os 8 preços foram sincronizados de
 * verdade com o Stripe TEST MODE (Stripe 4.1B) — `stripe_price_id=NULL` e
 * `active=false` deixaram de ser o estado oficial. TESTE 4/5 agora
 * validam o estado oficial ATUAL (sincronizado/ativo), não mais o estado
 * pré-Stripe.
 *
 * TESTES 1-6 leem as linhas REAIS de `pro`/`premium`/`free` (dado de
 * catálogo definitivo desta etapa, nunca alterado/removido pelos testes —
 * são os mesmos 8 preços que a V1 vai efetivamente vender). TESTES 7-10
 * (comportamento de constraint/RLS) usam um `plan` DESCARTÁVEL próprio,
 * exatamente como em `tests/integration/plan-prices-currency.test.ts`, para
 * nunca arriscar tocar no catálogo real.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  signInAsDisposableUser,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'

interface PlanPriceRow {
  interval: string
  currency: string
  amount: string
  active: boolean
  stripe_price_id: string | null
}

const PRO_EXPECTED: Record<string, number> = {
  'month:BRL': 19.9,
  'year:BRL': 199.0,
  'month:USD': 5.99,
  'year:USD': 59.0,
}

const PREMIUM_EXPECTED: Record<string, number> = {
  'month:BRL': 34.9,
  'year:BRL': 349.0,
  'month:USD': 9.99,
  'year:USD': 99.0,
}

describe.skipIf(!hasTestEnv())('plan_prices — catálogo comercial (Stripe 3)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let proPlanId: string
  let premiumPlanId: string
  let freePlanId: string
  let proRows: PlanPriceRow[]
  let premiumRows: PlanPriceRow[]

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    const { data: plans, error } = await admin.from('plans').select('id, slug').in('slug', ['pro', 'premium', 'free'])
    if (error || !plans) throw new Error(`[plan-prices-catalog.test] falha ao ler plans: ${error?.message}`)

    proPlanId = plans.find((p) => p.slug === 'pro')!.id
    premiumPlanId = plans.find((p) => p.slug === 'premium')!.id
    freePlanId = plans.find((p) => p.slug === 'free')!.id

    const { data: pro } = await admin
      .from('plan_prices')
      .select('interval, currency, amount, active, stripe_price_id')
      .eq('plan_id', proPlanId)
    proRows = (pro ?? []) as PlanPriceRow[]

    const { data: premium } = await admin
      .from('plan_prices')
      .select('interval, currency, amount, active, stripe_price_id')
      .eq('plan_id', premiumPlanId)
    premiumRows = (premium ?? []) as PlanPriceRow[]
  })

  it('TESTE 1 — existem exatamente 8 linhas comerciais para Pro/Premium (4 + 4)', () => {
    expect(proRows).toHaveLength(4)
    expect(premiumRows).toHaveLength(4)
  })

  it('TESTE 2 — Pro possui exatamente os 4 preços aprovados', () => {
    const byKey = Object.fromEntries(proRows.map((r) => [`${r.interval}:${r.currency}`, Number(r.amount)]))
    expect(byKey).toEqual(PRO_EXPECTED)
  })

  it('TESTE 3 — Premium possui exatamente os 4 preços aprovados', () => {
    const byKey = Object.fromEntries(premiumRows.map((r) => [`${r.interval}:${r.currency}`, Number(r.amount)]))
    expect(byKey).toEqual(PREMIUM_EXPECTED)
  })

  it('TESTE 4 — todas as 8 linhas estão sincronizadas: active = true (Stripe 4.1B)', () => {
    for (const row of [...proRows, ...premiumRows]) {
      expect(row.active).toBe(true)
    }
  })

  it('TESTE 5 — todas as 8 linhas têm stripe_price_id preenchido (Stripe 4.1B)', () => {
    for (const row of [...proRows, ...premiumRows]) {
      expect(typeof row.stripe_price_id).toBe('string')
      expect(row.stripe_price_id).not.toHaveLength(0)
    }
  })

  it('TESTE 4b — exatamente uma versão ativa por combinação plan+interval+currency', () => {
    for (const [label, rows] of [['pro', proRows], ['premium', premiumRows]] as const) {
      const combos = new Set<string>()
      for (const row of rows) {
        if (!row.active) continue
        const key = `${row.interval}:${row.currency}`
        expect(combos.has(key)).toBe(false) // já haveria uma ativa para essa combinação neste plano — duplicata
        combos.add(key)
      }
      expect(combos.size, `${label} deveria ter 4 combinações ativas (month/year × BRL/USD)`).toBe(4)
    }
  })

  it('TESTE 6 — Free não tem nenhuma linha em plan_prices', async () => {
    const { data, error } = await admin.from('plan_prices').select('id').eq('plan_id', freePlanId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  describe('TESTES 7-10 — comportamento de constraint/RLS (plano descartável, catálogo real nunca tocado)', () => {
    let testPlanId: string
    let user: DisposableUser
    let userClient: SupabaseClient

    beforeAll(async () => {
      const { data: plan, error } = await admin
        .from('plans')
        .insert({ name: 'Teste Stripe 3', slug: `test-stripe3-${Date.now().toString().slice(-8)}`, active: false })
        .select('id')
        .single()
      if (error || !plan) throw new Error(`[plan-prices-catalog.test] setup do plano de teste falhou: ${error?.message}`)
      testPlanId = plan.id as string

      user = await createDisposableUser(admin, 'plan-prices-catalog')
      userClient = await signInAsDisposableUser(env, user)
    })

    afterAll(async () => {
      await admin.from('plans').delete().eq('id', testPlanId)
      await deleteDisposableUser(admin, user.id)
    })

    it('TESTE 7 — currency inválida (ex.: EUR) é rejeitada pela nova CHECK constraint', async () => {
      const { error } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'EUR' })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('TESTE 8 — a unicidade (plan_id, interval, currency) continua ativa: duplicata falha', async () => {
      // Etapa "Stripe 3.2": a unicidade virou um índice único PARCIAL
      // (`WHERE active`) — duas linhas inativas para a mesma combinação
      // agora são permitidas de propósito (histórico de preços). Este
      // teste precisa `active: true` (+ `stripe_price_id`, exigido pelo
      // CHECK da Stripe 3.2) para continuar exercitando "só uma linha
      // ativa por combinação".
      const { error: firstError } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL', active: true, stripe_price_id: `price_test8_a_${Date.now()}` })
      expect(firstError).toBeNull()

      const { error: secondError } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL', active: true, stripe_price_id: `price_test8_b_${Date.now()}` })
      expect(secondError).not.toBeNull()
      expect(secondError?.code).toBe('23505')

      await admin.from('plan_prices').delete().eq('plan_id', testPlanId)
    })

    it('TESTE 9 — RLS preservado: usuário comum lê o catálogo mas não consegue inserir preço', async () => {
      const { data: selectData, error: selectError } = await userClient.from('plan_prices').select('id').limit(1)
      expect(selectError).toBeNull()
      expect(selectData).not.toBeNull()

      const { error: insertError } = await userClient
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
      expect(insertError).not.toBeNull()
    })

    it('TESTE 10 — FK e demais CHECK constraints preservadas (plan_id inexistente e amount negativo continuam falhando)', async () => {
      const { error: fkError } = await admin
        .from('plan_prices')
        .insert({ plan_id: '00000000-0000-0000-0000-000000000000', interval: 'month', amount: 1.0, currency: 'BRL' })
      expect(fkError).not.toBeNull()
      expect(fkError?.code).toBe('23503')

      const { error: amountError } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: -1.0, currency: 'BRL' })
      expect(amountError).not.toBeNull()
      expect(amountError?.code).toBe('23514')

      const invalidInterval = 'week'
      const { error: intervalError } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: invalidInterval, amount: 1.0, currency: 'BRL' })
      expect(intervalError).not.toBeNull()
      expect(intervalError?.code).toBe('23514')
    })
  })
})
