/**
 * tests/integration/plan-prices-versioning.test.ts
 * Etapa "Stripe 3.2 — Versionamento de plan_prices" — prova, contra
 * Supabase DEV real, que a migration
 * `20260905130000_plan_prices_versioning.sql` (a) permite histórico de
 * preços via índice único PARCIAL (`WHERE active`), (b) exige
 * `stripe_price_id` para qualquer linha `active=true`, (c) protege preços
 * históricos ainda referenciados por assinatura contra DELETE (FK
 * `subscriptions.stripe_price_id -> plan_prices.stripe_price_id`), e
 * (d) torna os termos comerciais de uma linha imutáveis depois de criados
 * (trigger `protect_plan_price_commercial_fields`) — sem alterar nada do
 * que já existia (RLS, CHECKs/FKs anteriores, entitlements).
 *
 * Todo o setup usa um `plan`/usuário/assinatura DESCARTÁVEIS, nunca as 8
 * linhas comerciais reais (Pro/Premium) semeadas na Stripe 3 — essas só
 * são lidas (nunca escritas) para o TESTE 12.
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

describe.skipIf(!hasTestEnv())('plan_prices — versionamento (Stripe 3.2)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let testPlanId: string
  let user: DisposableUser
  let userClient: SupabaseClient

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    const { data: plan, error } = await admin
      .from('plans')
      .insert({ name: 'Teste Stripe 3.2', slug: `test-stripe32-${Date.now().toString().slice(-8)}`, active: false })
      .select('id')
      .single()
    if (error || !plan) throw new Error(`[plan-prices-versioning.test] setup do plano de teste falhou: ${error?.message}`)
    testPlanId = plan.id as string

    user = await createDisposableUser(admin, 'plan-prices-versioning')
    userClient = await signInAsDisposableUser(env, user)
  })

  afterAll(async () => {
    // subscriptions primeiro (referencia plan_prices por FK — precisa sumir
    // antes de qualquer plan_prices poder ser removido), depois plan_prices,
    // depois o plano de teste, depois o usuário descartável.
    await admin.from('subscriptions').delete().eq('plan_id', testPlanId)
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await admin.from('plan_prices').delete().eq('plan_id', testPlanId)
    await admin.from('plans').delete().eq('id', testPlanId)
    await deleteDisposableUser(admin, user.id)
  })

  it('TESTE 1 — múltiplas versões históricas (active=false) do mesmo plan+interval+currency coexistem', async () => {
    const { error: oldError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 19.9, currency: 'BRL', active: false })
    expect(oldError).toBeNull()

    const { error: newError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 24.9, currency: 'BRL', active: false })
    expect(newError).toBeNull()

    const { data } = await admin
      .from('plan_prices')
      .select('amount')
      .eq('plan_id', testPlanId)
      .eq('interval', 'month')
      .eq('currency', 'BRL')
    expect(data?.map((r) => Number(r.amount)).sort()).toEqual([19.9, 24.9])

    await admin.from('plan_prices').delete().eq('plan_id', testPlanId).eq('interval', 'month').eq('currency', 'BRL')
  })

  it('TESTE 2 — somente uma versão pode ser active=true por combinação (índice único parcial)', async () => {
    const { error: firstError } = await admin.from('plan_prices').insert({
      plan_id: testPlanId,
      interval: 'year',
      amount: 199.0,
      currency: 'BRL',
      active: true,
      stripe_price_id: `price_test_a_${Date.now()}`,
    })
    expect(firstError).toBeNull()

    const { error: secondError } = await admin.from('plan_prices').insert({
      plan_id: testPlanId,
      interval: 'year',
      amount: 249.0,
      currency: 'BRL',
      active: true,
      stripe_price_id: `price_test_b_${Date.now()}`,
    })
    expect(secondError).not.toBeNull()
    expect(secondError?.code).toBe('23505')

    await admin.from('plan_prices').delete().eq('plan_id', testPlanId).eq('interval', 'year').eq('currency', 'BRL')
  })

  describe('TESTES 3/4 — grandfathering: preço histórico ainda usado por subscription', () => {
    let historicalPriceId: string
    const historicalStripePriceId = `price_test_grandfathered_${Date.now()}`
    let billingCustomerId: string
    let subscriptionId: string

    beforeAll(async () => {
      // Etapa "Stripe 3.4": effective_until precisa ser estritamente
      // posterior a effective_from (chk_plan_prices_effective_period) —
      // sem um effective_from explícito no passado, o DEFAULT now() cairia
      // no mesmo instante de effective_until (mesma transação), violando a
      // constraint. Um preço histórico real sempre teve um effective_from
      // anterior à sua data de encerramento.
      const { data: price, error: priceError } = await admin
        .from('plan_prices')
        .insert({
          plan_id: testPlanId,
          interval: 'month',
          amount: 19.9,
          currency: 'BRL',
          active: false,
          stripe_price_id: historicalStripePriceId,
          effective_from: '2026-01-01T00:00:00Z',
          effective_until: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (priceError || !price) throw new Error(`setup do preço histórico falhou: ${priceError?.message}`)
      historicalPriceId = price.id as string

      const { data: customer, error: customerError } = await admin
        .from('billing_customers')
        .insert({ user_id: user.id, stripe_customer_id: `cus_test_${Date.now()}` })
        .select('id')
        .single()
      if (customerError || !customer) throw new Error(`setup de billing_customers falhou: ${customerError?.message}`)
      billingCustomerId = customer.id as string

      const { data: subscription, error: subscriptionError } = await admin
        .from('subscriptions')
        .insert({
          user_id: user.id,
          billing_customer_id: billingCustomerId,
          stripe_subscription_id: `sub_test_${Date.now()}`,
          stripe_price_id: historicalStripePriceId,
          plan_id: testPlanId,
          status: 'active',
        })
        .select('id')
        .single()
      if (subscriptionError || !subscription) throw new Error(`setup de subscription falhou: ${subscriptionError?.message}`)
      subscriptionId = subscription.id as string
    })

    // Este describe usa o MESMO usuário descartável compartilhado por todo o
    // arquivo (inclusive pelo TESTE 12, que depende dele resolver como
    // 'free'). Uma subscription 'active' deixada para trás mudaria
    // permanentemente o plano efetivo desse usuário para os testes
    // seguintes (achado real: capturado ao rodar a suíte completa) — por
    // isso a limpeza acontece aqui, logo após TESTE 3/4, nunca só no
    // afterAll do arquivo inteiro.
    afterAll(async () => {
      await admin.from('subscriptions').delete().eq('id', subscriptionId)
      await admin.from('plan_prices').delete().eq('id', historicalPriceId)
      await admin.from('billing_customers').delete().eq('id', billingCustomerId)
    })

    it('TESTE 3 — a subscription referencia normalmente o preço histórico (grandfathering funciona)', async () => {
      const { data: subscriptionRow, error: subscriptionReadError } = await admin
        .from('subscriptions')
        .select('stripe_price_id')
        .eq('id', subscriptionId)
        .single()
      expect(subscriptionReadError).toBeNull()
      expect(subscriptionRow?.stripe_price_id).toBe(historicalStripePriceId)

      // O preço histórico continua legível/íntegro por si só — inativo, mas não removido.
      const { data: priceRow, error: priceReadError } = await admin
        .from('plan_prices')
        .select('active, amount')
        .eq('id', historicalPriceId)
        .single()
      expect(priceReadError).toBeNull()
      expect(priceRow?.active).toBe(false)
      expect(Number(priceRow?.amount)).toBe(19.9)
    })

    it('TESTE 4 — o preço histórico não pode ser deletado enquanto a subscription existir (FK RESTRICT)', async () => {
      const { error } = await admin.from('plan_prices').delete().eq('id', historicalPriceId)
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23503')
    })
  })

  it('TESTE 5 — preço active=true sem stripe_price_id falha (CHECK)', async () => {
    const { error } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'USD', active: true, stripe_price_id: null })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
  })

  it('TESTE 6 — preço active=false sem stripe_price_id continua permitido (estado real das 8 linhas comerciais)', async () => {
    const { error } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'USD', active: false, stripe_price_id: null })
    expect(error).toBeNull()

    await admin.from('plan_prices').delete().eq('plan_id', testPlanId).eq('interval', 'month').eq('currency', 'USD')
  })

  it('TESTE 7 — BRL e USD continuam coexistindo (Stripe 1 preservado)', async () => {
    const { error: brlError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL', active: false })
    expect(brlError).toBeNull()

    const { error: usdError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'USD', active: false })
    expect(usdError).toBeNull()

    await admin.from('plan_prices').delete().eq('plan_id', testPlanId).eq('interval', 'month')
  })

  it('TESTE 8 — month e year continuam coexistindo', async () => {
    const { error: monthError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL', active: false })
    expect(monthError).toBeNull()

    const { error: yearError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'year', amount: 10.0, currency: 'BRL', active: false })
    expect(yearError).toBeNull()

    await admin.from('plan_prices').delete().eq('plan_id', testPlanId).eq('currency', 'BRL')
  })

  it('TESTE 9 — plan_prices continua com RLS correto (usuário comum lê, não escreve)', async () => {
    const { data: selectData, error: selectError } = await userClient.from('plan_prices').select('id').limit(1)
    expect(selectError).toBeNull()
    expect(selectData).not.toBeNull()

    const { error: insertError } = await userClient
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'BRL', active: false })
    expect(insertError).not.toBeNull()
  })

  it('TESTE 10 — subscriptions continua com RLS correto (usuário comum não vê nem escreve, nem a própria linha)', async () => {
    const { data: selectData, error: selectError } = await userClient.from('subscriptions').select('id').eq('user_id', user.id)
    expect(selectError).toBeNull()
    expect(selectData).toEqual([]) // nenhuma policy de SELECT libera o próprio usuário — só is_platform_admin()

    const { error: insertError } = await userClient.from('subscriptions').insert({
      user_id: user.id,
      billing_customer_id: '00000000-0000-0000-0000-000000000000',
      stripe_subscription_id: 'sub_should_not_work',
      plan_id: testPlanId,
      status: 'active',
    })
    expect(insertError).not.toBeNull()
  })

  it('TESTE 11 — CHECKs e FKs anteriores continuam funcionando (currency, interval, amount, plan_id, stripe_price_id)', async () => {
    const { error: currencyError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: 1.0, currency: 'EUR' })
    expect(currencyError?.code).toBe('23514')

    const invalidInterval = 'week'
    const { error: intervalError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: invalidInterval, amount: 1.0, currency: 'BRL' })
    expect(intervalError?.code).toBe('23514')

    const { error: amountError } = await admin
      .from('plan_prices')
      .insert({ plan_id: testPlanId, interval: 'month', amount: -1.0, currency: 'BRL' })
    expect(amountError?.code).toBe('23514')

    const { error: fkError } = await admin
      .from('plan_prices')
      .insert({ plan_id: '00000000-0000-0000-0000-000000000000', interval: 'month', amount: 1.0, currency: 'BRL' })
    expect(fkError?.code).toBe('23503')

    const sharedStripePriceId = `price_test_dup_${Date.now()}`
    const { error: firstDupError } = await admin.from('plan_prices').insert({
      plan_id: testPlanId,
      interval: 'month',
      amount: 1.0,
      currency: 'BRL',
      active: false,
      stripe_price_id: sharedStripePriceId,
    })
    expect(firstDupError).toBeNull()
    const { error: secondDupError } = await admin.from('plan_prices').insert({
      plan_id: testPlanId,
      interval: 'year',
      amount: 1.0,
      currency: 'BRL',
      active: false,
      stripe_price_id: sharedStripePriceId,
    })
    expect(secondDupError?.code).toBe('23505')

    await admin.from('plan_prices').delete().eq('plan_id', testPlanId).eq('stripe_price_id', sharedStripePriceId)
  })

  it('TESTE 12 — plan_entitlements/effective_plans() continuam intactos (não alterados por esta etapa)', async () => {
    const { data: entitlements, error: entitlementsError } = await admin
      .from('plan_entitlements')
      .select('feature_key, plans:plan_id(slug)')
    expect(entitlementsError).toBeNull()
    expect(entitlements).toHaveLength(9)

    // Comportamento ponta-a-ponta: um usuário Free (sem benefit_grants/subscriptions)
    // continua resolvendo entitlements normalmente via get_my_entitlement().
    const { data: entitlement, error: rpcError } = await userClient.rpc('get_my_entitlement', {
      p_feature_key: 'collection_basic',
    })
    expect(rpcError).toBeNull()
    expect(entitlement?.[0]?.enabled).toBe(true)
    expect(entitlement?.[0]?.plan_slug).toBe('free')
    expect(entitlement?.[0]?.source).toBe('default')
  })

  describe('imutabilidade dos termos comerciais (trigger protect_plan_price_commercial_fields)', () => {
    let immutablePriceId: string
    const originalStripePriceId = `price_test_immutable_${Date.now()}`

    beforeAll(async () => {
      const { data, error } = await admin
        .from('plan_prices')
        .insert({
          plan_id: testPlanId,
          interval: 'month',
          amount: 19.9,
          currency: 'BRL',
          active: false,
          stripe_price_id: originalStripePriceId,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`setup para teste de imutabilidade falhou: ${error?.message}`)
      immutablePriceId = data.id as string
    })

    afterAll(async () => {
      await admin.from('plan_prices').delete().eq('id', immutablePriceId)
    })

    it('amount não pode ser alterado depois de criado', async () => {
      const { error } = await admin.from('plan_prices').update({ amount: 24.9 }).eq('id', immutablePriceId)
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('currency/interval/plan_id não podem ser alterados depois de criados', async () => {
      const { error: currencyError } = await admin.from('plan_prices').update({ currency: 'USD' }).eq('id', immutablePriceId)
      expect(currencyError?.code).toBe('23514')

      const { error: intervalError } = await admin.from('plan_prices').update({ interval: 'year' }).eq('id', immutablePriceId)
      expect(intervalError?.code).toBe('23514')
    })

    it('stripe_price_id não pode ser trocado depois de definido', async () => {
      const { error } = await admin
        .from('plan_prices')
        .update({ stripe_price_id: `price_test_other_${Date.now()}` })
        .eq('id', immutablePriceId)
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('active e effective_until continuam livremente editáveis (ciclo de vida do preço)', async () => {
      const { error } = await admin
        .from('plan_prices')
        .update({ active: false, effective_until: new Date().toISOString() })
        .eq('id', immutablePriceId)
      expect(error).toBeNull()
    })
  })
})
