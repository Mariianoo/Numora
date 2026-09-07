/**
 * tests/integration/plan-prices-subscription-integrity.test.ts
 * Etapa "Stripe 3.4 — Fechamento das integridades pré-Stripe" — prova,
 * contra Supabase DEV real, que a migration
 * `20260905140000_plan_prices_and_subscription_integrity.sql` implementa
 * exatamente as 2 proteções aprovadas:
 *
 *   A) plan_prices: CHECK chk_plan_prices_effective_period
 *      (effective_until IS NULL OR effective_until > effective_from).
 *   B) subscriptions: trigger check_subscription_plan_matches_price —
 *      subscriptions.plan_id precisa corresponder ao plan_id do
 *      plan_prices referenciado por subscriptions.stripe_price_id (quando
 *      não-nulo). Roda via SECURITY DEFINER trigger, nunca depende de RLS
 *      — vale igual para service_role/webhook.
 *
 * Nenhum CHECK usando now() foi criado (ver relatório da etapa) — não há
 * o que testar aqui além de confirmar sua ausência via leitura direta do
 * catálogo do Postgres (feito manualmente, fora deste arquivo, já que a
 * API pública não expõe pg_constraint).
 *
 * Cada preocupação usa seu PRÓPRIO usuário/plano descartável — a Stripe
 * 3.2 encontrou um bug real de dependência de ordem por compartilhar um
 * único usuário entre testes de subscription e de entitlement; aqui cada
 * describe é inteiramente isolado, nunca reaproveitando estado entre
 * preocupações diferentes.
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

describe.skipIf(!hasTestEnv())('plan_prices + subscriptions — integridade (Stripe 3.4)', () => {
  let env: TestEnv
  let admin: SupabaseClient

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
  })

  describe('A) chk_plan_prices_effective_period', () => {
    let planId: string

    beforeAll(async () => {
      const { data, error } = await admin
        .from('plans')
        .insert({ name: 'Teste Stripe 3.4 — período', slug: `test-stripe34-period-${Date.now().toString().slice(-8)}`, active: false })
        .select('id')
        .single()
      if (error || !data) throw new Error(`setup do plano falhou: ${error?.message}`)
      planId = data.id as string
    })

    afterAll(async () => {
      await admin.from('plan_prices').delete().eq('plan_id', planId)
      await admin.from('plans').delete().eq('id', planId)
    })

    it('TESTE 1 — effective_until NULL é permitido', async () => {
      const { error } = await admin
        .from('plan_prices')
        .insert({ plan_id: planId, interval: 'month', amount: 1.0, currency: 'BRL', active: false })
      expect(error).toBeNull()
    })

    it('TESTE 2 — effective_until posterior a effective_from é permitido', async () => {
      const from = new Date('2026-01-01T00:00:00Z')
      const until = new Date('2027-01-01T00:00:00Z')
      const { error } = await admin.from('plan_prices').insert({
        plan_id: planId,
        interval: 'year',
        amount: 1.0,
        currency: 'BRL',
        active: false,
        effective_from: from.toISOString(),
        effective_until: until.toISOString(),
      })
      expect(error).toBeNull()
    })

    it('TESTE 3 — effective_until igual a effective_from é rejeitado', async () => {
      const same = new Date('2026-06-01T00:00:00Z').toISOString()
      const { error } = await admin.from('plan_prices').insert({
        plan_id: planId,
        interval: 'month',
        amount: 1.0,
        currency: 'USD',
        active: false,
        effective_from: same,
        effective_until: same,
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('TESTE 4 — effective_until anterior a effective_from é rejeitado', async () => {
      const { error } = await admin.from('plan_prices').insert({
        plan_id: planId,
        interval: 'year',
        amount: 1.0,
        currency: 'USD',
        active: false,
        effective_from: '2027-01-01T00:00:00Z',
        effective_until: '2026-01-01T00:00:00Z',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('active=false com effective_from futuro é permitido (rascunho agendado)', async () => {
      const { error } = await admin.from('plan_prices').insert({
        plan_id: planId,
        interval: 'month',
        amount: 1.0,
        currency: 'USD',
        active: false,
        effective_from: '2099-01-01T00:00:00Z',
      })
      expect(error).toBeNull()
      await admin.from('plan_prices').delete().eq('plan_id', planId).eq('effective_from', '2099-01-01T00:00:00+00:00')
    })

    it('active=false com effective_until NULL é permitido (estado real das 8 linhas comerciais)', async () => {
      const { data, error } = await admin
        .from('plan_prices')
        .select('effective_until')
        .eq('plan_id', planId)
        .eq('interval', 'month')
        .eq('currency', 'BRL')
        .single()
      expect(error).toBeNull()
      expect(data?.effective_until).toBeNull()
    })
  })

  describe('B) check_subscription_plan_matches_price', () => {
    let planAId: string
    let planBId: string
    const priceA1StripeId = `price_test34_a1_${Date.now()}`
    const priceA2StripeId = `price_test34_a2_${Date.now()}`
    const priceB1StripeId = `price_test34_b1_${Date.now()}`
    let user: DisposableUser
    let billingCustomerId: string
    let subscriptionId: string

    beforeAll(async () => {
      const suffix = Date.now().toString().slice(-8)
      const { data: planA, error: planAError } = await admin
        .from('plans')
        .insert({ name: 'Teste Stripe 3.4 — plano A', slug: `test-stripe34-a-${suffix}`, active: false })
        .select('id')
        .single()
      if (planAError || !planA) throw new Error(`setup do plano A falhou: ${planAError?.message}`)
      planAId = planA.id as string

      const { data: planB, error: planBError } = await admin
        .from('plans')
        .insert({ name: 'Teste Stripe 3.4 — plano B', slug: `test-stripe34-b-${suffix}`, active: false })
        .select('id')
        .single()
      if (planBError || !planB) throw new Error(`setup do plano B falhou: ${planBError?.message}`)
      planBId = planB.id as string

      const { error: priceA1Error } = await admin.from('plan_prices').insert({
        plan_id: planAId,
        interval: 'month',
        amount: 1.0,
        currency: 'BRL',
        active: false,
        stripe_price_id: priceA1StripeId,
      })
      if (priceA1Error) throw new Error(`setup do preço A1 falhou: ${priceA1Error.message}`)

      const { error: priceA2Error } = await admin.from('plan_prices').insert({
        plan_id: planAId,
        interval: 'year',
        amount: 10.0,
        currency: 'BRL',
        active: false,
        stripe_price_id: priceA2StripeId,
      })
      if (priceA2Error) throw new Error(`setup do preço A2 falhou: ${priceA2Error.message}`)

      const { error: priceB1Error } = await admin.from('plan_prices').insert({
        plan_id: planBId,
        interval: 'month',
        amount: 1.0,
        currency: 'BRL',
        active: false,
        stripe_price_id: priceB1StripeId,
      })
      if (priceB1Error) throw new Error(`setup do preço B1 falhou: ${priceB1Error.message}`)

      user = await createDisposableUser(admin, 'plan-prices-sub-integrity')

      const { data: customer, error: customerError } = await admin
        .from('billing_customers')
        .insert({ user_id: user.id, stripe_customer_id: `cus_test34_${Date.now()}` })
        .select('id')
        .single()
      if (customerError || !customer) throw new Error(`setup de billing_customers falhou: ${customerError?.message}`)
      billingCustomerId = customer.id as string
    })

    afterAll(async () => {
      await admin.from('subscriptions').delete().eq('billing_customer_id', billingCustomerId)
      await admin.from('billing_customers').delete().eq('id', billingCustomerId)
      await admin.from('plan_prices').delete().in('plan_id', [planAId, planBId])
      await admin.from('plans').delete().in('id', [planAId, planBId])
      await deleteDisposableUser(admin, user.id)
    })

    it('TESTE 5 — subscription com stripe_price_id NULL é permitida (sem exigir correspondência)', async () => {
      const { data, error } = await admin
        .from('subscriptions')
        .insert({
          user_id: user.id,
          billing_customer_id: billingCustomerId,
          stripe_subscription_id: `sub_test34_null_${Date.now()}`,
          stripe_price_id: null,
          plan_id: planAId,
          status: 'active',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      if (data) await admin.from('subscriptions').delete().eq('id', data.id)
    })

    it('TESTE 6 — subscription com stripe_price_id válido e plan_id correspondente é permitida', async () => {
      const { data, error } = await admin
        .from('subscriptions')
        .insert({
          user_id: user.id,
          billing_customer_id: billingCustomerId,
          stripe_subscription_id: `sub_test34_${Date.now()}`,
          stripe_price_id: priceA1StripeId,
          plan_id: planAId,
          status: 'active',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data).not.toBeNull()
      subscriptionId = data!.id as string
    })

    it('TESTE 7 — subscription com stripe_price_id válido mas plan_id diferente é rejeitada (INSERT)', async () => {
      const { error } = await admin.from('subscriptions').insert({
        user_id: user.id,
        billing_customer_id: billingCustomerId,
        stripe_subscription_id: `sub_test34_mismatch_${Date.now()}`,
        stripe_price_id: priceB1StripeId,
        plan_id: planAId, // price B1 pertence a planB, não planA
        status: 'active',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('TESTE 8 — UPDATE de plan_id para valor incompatível é rejeitado', async () => {
      const { error } = await admin.from('subscriptions').update({ plan_id: planBId }).eq('id', subscriptionId)
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')

      const { data } = await admin.from('subscriptions').select('plan_id').eq('id', subscriptionId).single()
      expect(data?.plan_id).toBe(planAId) // update rejeitado, estado original preservado
    })

    it('TESTE 9 — UPDATE de stripe_price_id para Price de outro plan é rejeitado', async () => {
      const { error } = await admin.from('subscriptions').update({ stripe_price_id: priceB1StripeId }).eq('id', subscriptionId)
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')

      const { data } = await admin.from('subscriptions').select('stripe_price_id').eq('id', subscriptionId).single()
      expect(data?.stripe_price_id).toBe(priceA1StripeId) // update rejeitado, estado original preservado
    })

    it('TESTE 10 — trocar para outro Price do MESMO plan_id continua permitido', async () => {
      const { error } = await admin.from('subscriptions').update({ stripe_price_id: priceA2StripeId }).eq('id', subscriptionId)
      expect(error).toBeNull()

      const { data } = await admin.from('subscriptions').select('stripe_price_id').eq('id', subscriptionId).single()
      expect(data?.stripe_price_id).toBe(priceA2StripeId)
    })

    it('TESTE 14 — FK subscriptions.stripe_price_id → plan_prices.stripe_price_id continua ON DELETE RESTRICT', async () => {
      // Depois do TESTE 10, subscriptionId aponta para priceA2StripeId — deletar essa linha deve continuar falhando.
      const { error } = await admin.from('plan_prices').delete().eq('stripe_price_id', priceA2StripeId)
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23503')
    })
  })

  describe('C) effective_plans()/get_entitlement() inalterados (usuário isolado, nunca tocado por subscription)', () => {
    let entitlementUser: DisposableUser
    let entitlementUserClient: SupabaseClient

    beforeAll(async () => {
      entitlementUser = await createDisposableUser(admin, 'stripe34-entitlement')
      entitlementUserClient = await signInAsDisposableUser(env, entitlementUser)
    })

    afterAll(async () => {
      await deleteDisposableUser(admin, entitlementUser.id)
    })

    it('TESTE 11 — effective_plans()/get_effective_plan() continuam resolvendo "free" exatamente como antes', async () => {
      const { data, error } = await admin.rpc('get_effective_plan', { p_user_id: entitlementUser.id })
      expect(error).toBeNull()
      expect(data?.[0]?.plan_slug).toBe('free')
      expect(data?.[0]?.source).toBe('default')
    })

    it('TESTE 12 — get_entitlement()/get_my_entitlement() continuam retornando o mesmo resultado de antes', async () => {
      const { data, error } = await entitlementUserClient.rpc('get_my_entitlement', { p_feature_key: 'collection_basic' })
      expect(error).toBeNull()
      expect(data?.[0]?.enabled).toBe(true)
      expect(data?.[0]?.plan_slug).toBe('free')
      expect(data?.[0]?.source).toBe('default')
    })
  })

  describe('D) RLS permanece intacto (usuário isolado, só para este teste)', () => {
    let rlsUser: DisposableUser
    let rlsUserClient: SupabaseClient

    beforeAll(async () => {
      rlsUser = await createDisposableUser(admin, 'stripe34-rls')
      rlsUserClient = await signInAsDisposableUser(env, rlsUser)
    })

    afterAll(async () => {
      await deleteDisposableUser(admin, rlsUser.id)
    })

    it('TESTE 13 — plan_prices: usuário comum lê, não escreve; subscriptions: usuário comum não vê nem escreve', async () => {
      const { data: planPricesSelect, error: planPricesSelectError } = await rlsUserClient.from('plan_prices').select('id').limit(1)
      expect(planPricesSelectError).toBeNull()
      expect(planPricesSelect).not.toBeNull()

      const { error: planPricesInsertError } = await rlsUserClient
        .from('plan_prices')
        .insert({ plan_id: '00000000-0000-0000-0000-000000000000', interval: 'month', amount: 1.0, currency: 'BRL' })
      expect(planPricesInsertError).not.toBeNull()

      const { data: subscriptionsSelect, error: subscriptionsSelectError } = await rlsUserClient
        .from('subscriptions')
        .select('id')
        .eq('user_id', rlsUser.id)
      expect(subscriptionsSelectError).toBeNull()
      expect(subscriptionsSelect).toEqual([])

      const { error: subscriptionsInsertError } = await rlsUserClient.from('subscriptions').insert({
        user_id: rlsUser.id,
        billing_customer_id: '00000000-0000-0000-0000-000000000000',
        stripe_subscription_id: 'sub_should_not_work',
        plan_id: '00000000-0000-0000-0000-000000000000',
        status: 'active',
      })
      expect(subscriptionsInsertError).not.toBeNull()
    })
  })

  it('TESTE 15 — os 8 preços comerciais reais (Pro/Premium) continuam intactos', async () => {
    const { data: plans } = await admin.from('plans').select('id, slug').in('slug', ['pro', 'premium'])
    const proId = plans?.find((p) => p.slug === 'pro')?.id
    const premiumId = plans?.find((p) => p.slug === 'premium')?.id

    const { data: rows, error } = await admin
      .from('plan_prices')
      .select('plan_id, interval, currency, amount, active, stripe_price_id')
      .in('plan_id', [proId, premiumId])
    expect(error).toBeNull()
    expect(rows).toHaveLength(8)
    for (const row of rows ?? []) {
      expect(row.active).toBe(false)
      expect(row.stripe_price_id).toBeNull()
    }

    const byKey = Object.fromEntries(
      (rows ?? []).map((r) => [`${r.plan_id === proId ? 'pro' : 'premium'}:${r.interval}:${r.currency}`, Number(r.amount)]),
    )
    expect(byKey).toEqual({
      'pro:month:BRL': 19.9,
      'pro:year:BRL': 199.0,
      'pro:month:USD': 5.99,
      'pro:year:USD': 59.0,
      'premium:month:BRL': 34.9,
      'premium:year:BRL': 349.0,
      'premium:month:USD': 9.99,
      'premium:year:USD': 99.0,
    })
  })
})
