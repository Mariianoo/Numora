/**
 * tests/integration/plan-prices-currency.test.ts
 * Etapa "Stripe 1 — Correção multimoeda do plan_prices" — prova, contra
 * Supabase DEV real, que a migration
 * `20260905110000_add_currency_to_plan_prices_uniqueness.sql` trocou
 * exatamente UNIQUE(plan_id, interval) por UNIQUE(plan_id, interval,
 * currency), sem alterar nenhum outro comportamento da tabela.
 *
 * `plan_prices` não é escopada por usuário (é catálogo comercial) — os
 * testes usam um `plan` DESCARTÁVEL criado só para esta suíte (nunca os
 * planos reais `free`/`pro`/`premium`), para nunca poluir o catálogo real
 * nem colidir com o `active=false` deles. Escrita em `plan_prices` exige
 * `is_platform_owner()` (RLS já auditada em "Stripe 0") — por isso todo
 * insert/delete de setup usa `admin` (service_role); o teste de RLS abaixo
 * usa um usuário comum de verdade para confirmar que a policy continua
 * bloqueando, exatamente como testado em `tests/integration/rls.test.ts`.
 *
 * Nenhum preço comercial real é inserido — só valores claramente fictícios
 * (`1.00`) num plano de teste, nunca usados por `effective_plans()`/
 * entitlements (que resolvem por `plan_id`, nunca leem `plan_prices`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

describe.skipIf(!hasTestEnv())('plan_prices — unicidade (plan_id, interval, currency)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let testPlanId: string
  let otherPlanId: string
  let user: DisposableUser
  let userClient: SupabaseClient

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    const suffix = Date.now().toString().slice(-8)

    const { data: planA, error: planAError } = await admin
      .from('plans')
      .insert({ name: 'Teste Stripe 1 A', slug: `test-stripe1-a-${suffix}`, active: false })
      .select('id')
      .single()
    if (planAError || !planA) throw new Error(`[plan-prices-currency.test] setup do plano A falhou: ${planAError?.message}`)
    testPlanId = planA.id as string

    const { data: planB, error: planBError } = await admin
      .from('plans')
      .insert({ name: 'Teste Stripe 1 B', slug: `test-stripe1-b-${suffix}`, active: false })
      .select('id')
      .single()
    if (planBError || !planB) throw new Error(`[plan-prices-currency.test] setup do plano B falhou: ${planBError?.message}`)
    otherPlanId = planB.id as string

    user = await createDisposableUser(admin, 'plan-prices')
    userClient = await signInAsDisposableUser(env, user)
  })

  afterEach(async () => {
    // Cada teste limpa suas próprias linhas de plan_prices, para o próximo
    // teste sempre partir de um estado limpo (evita falso-positivo por
    // resíduo de um teste anterior).
    await admin.from('plan_prices').delete().in('plan_id', [testPlanId, otherPlanId])
  })

  afterAll(async () => {
    await admin.from('plans').delete().in('id', [testPlanId, otherPlanId])
    await deleteDisposableUser(admin, user.id)
  })

  it('TESTE 1 — mesmo plano/intervalo em moedas diferentes (BRL e USD) coexistem', async () => {
    const { error: brlError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(brlError).toBeNull()

    const { error: usdError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'USD' })
    expect(usdError).toBeNull()

    const { data, error } = await admin
      .from('plan_prices')
      .select('currency')
      .eq('plan_id', testPlanId)
      .eq('interval', 'month')
    expect(error).toBeNull()
    expect(data?.map((row) => row.currency).sort()).toEqual(['BRL', 'USD'])
  })

  it('TESTE 2 — a mesma combinação (plano, intervalo, moeda) duplicada falha por violação de unicidade', async () => {
    const { error: firstError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(firstError).toBeNull()

    const { error: secondError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(secondError).not.toBeNull()
    expect(secondError?.code).toBe('23505')
  })

  it('TESTE 3 — mesmo plano/moeda em intervalos diferentes (month e year) coexistem', async () => {
    const { error: monthError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(monthError).toBeNull()

    const { error: yearError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'year', amount: 10.0, currency: 'BRL' })
    expect(yearError).toBeNull()

    const { data } = await admin.from('plan_prices').select('interval').eq('plan_id', testPlanId).eq('currency', 'BRL')
    expect(data?.map((row) => row.interval).sort()).toEqual(['month', 'year'])
  })

  it('TESTE 4 — mesmo intervalo/moeda em planos diferentes coexistem', async () => {
    const { error: planAError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(planAError).toBeNull()

    const { error: planBError } = await admin
      .from('plan_prices')
      .insert({ plan_id: otherPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(planBError).toBeNull()

    const { data } = await admin
      .from('plan_prices')
      .select('plan_id')
      .in('plan_id', [testPlanId, otherPlanId])
      .eq('interval', 'month')
      .eq('currency', 'BRL')
    expect(data).toHaveLength(2)
  })

  describe('TESTE 5 — preservação da estrutura (nada além da unicidade mudou)', () => {
    it('foreign key plan_id ainda é validada (plan_id inexistente falha)', async () => {
      const { error } = await admin
        .from('plan_prices')
        .insert({ plan_id: '00000000-0000-0000-0000-000000000000', interval: 'month', amount: 1.0, currency: 'BRL' })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23503')
    })

    it('CHECK de interval ainda é validado (valor fora de month/year falha)', async () => {
      const invalidInterval = 'week'
      const { error } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: invalidInterval, amount: 1.0, currency: 'BRL' })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('CHECK de amount ainda é validado (valor negativo falha)', async () => {
      const { error } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: -1.0, currency: 'BRL' })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('UNIQUE(stripe_price_id) — a outra constraint de unicidade, não tocada por esta migration, continua ativa', async () => {
      const sharedStripePriceId = `price_test_stripe1_${Date.now()}`
      const { error: firstError } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL', stripe_price_id: sharedStripePriceId })
      expect(firstError).toBeNull()

      const { error: secondError } = await admin
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'year', amount: 1.0, currency: 'BRL', stripe_price_id: sharedStripePriceId })
      expect(secondError).not.toBeNull()
      expect(secondError?.code).toBe('23505')
    })

    it('RLS/policies inalteradas: usuário autenticado comum lê o catálogo mas não consegue inserir preço', async () => {
      const { data: selectData, error: selectError } = await userClient.from('plan_prices').select('id').limit(1)
      expect(selectError).toBeNull()
      expect(selectData).not.toBeNull()

      const { error: insertError } = await userClient
        .from('plan_prices')
        .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
      expect(insertError).not.toBeNull()
    })

    it('índice não relacionado (idx_plan_prices_plan_id) continua permitindo múltiplas linhas por plano', async () => {
      await admin.from('plan_prices').insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL' })
      await admin.from('plan_prices').insert({ plan_id: testPlanId, interval: 'year', amount: 1.0, currency: 'BRL' })

      const { data, error } = await admin.from('plan_prices').select('id').eq('plan_id', testPlanId)
      expect(error).toBeNull()
      expect(data).toHaveLength(2)
    })
  })
})
