/**
 * tests/integration/dashboard-advanced-gate.test.ts
 * Etapa "5.9C — Dashboard Gate" — prova, contra Supabase DEV real (e
 * Stripe TEST real para o ciclo de vida de assinatura), que
 * `get_my_entitlement('dashboard_advanced')` — a fonte de verdade que
 * `app/dashboard/page.tsx` consulta para decidir entre a versão básica e a
 * avançada — resolve corretamente para cada estado de plano.
 *
 * NÃO renderiza o Server Component (este projeto não tem infraestrutura de
 * teste de renderização React — todo o resto da suíte testa a camada de
 * dados, nunca o componente em si). A prova de que a UI reage corretamente
 * a `enabled=true/false` foi feita manualmente no navegador (ver relatório
 * do checkpoint 5.9C) — aqui provamos que a FONTE DE DADOS que a página
 * consulta está correta, sob todos os estados de plano relevantes.
 *
 * Reaproveita inteiramente a cadeia de entitlement já existente e testada
 * (effective_plans → get_effective_plan → get_entitlement →
 * get_my_entitlement) — nenhuma lógica nova de prioridade courtesy/
 * subscription/free é testada aqui de novo, só o novo feature_key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'
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

interface EntitlementRow {
  enabled: boolean
  limit_value: number | null
  plan_slug: string
  source: string
}

describe.skipIf(!hasTestEnv())('dashboard_advanced entitlement (DEV real + Stripe TEST real) — Etapa 5.9C', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  let proMonthBrlPriceId: string
  const createdStripeCustomerIds = new Set<string>()

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()

    const { data } = await admin.from('plan_prices').select('stripe_price_id, plans:plan_id(slug)').eq('interval', 'month').eq('currency', 'BRL').eq('active', true)
    for (const row of data ?? []) {
      const slug = Array.isArray(row.plans) ? row.plans[0]?.slug : (row.plans as { slug: string } | null)?.slug
      if (slug === 'pro') proMonthBrlPriceId = row.stripe_price_id as string
    }
  })

  afterAll(async () => {
    await Promise.allSettled(
      Array.from(createdStripeCustomerIds).map(async (id) => {
        try {
          const subs = await stripe.subscriptions.list({ customer: id, status: 'all' })
          await Promise.allSettled(subs.data.filter((s) => s.status !== 'canceled').map((s) => stripe.subscriptions.cancel(s.id).catch(() => undefined)))
          await stripe.customers.del(id)
        } catch {
          // best-effort
        }
      }),
    )
  }, 60_000)

  async function getDashboardAdvancedEntitlement(client: SupabaseClient): Promise<EntitlementRow> {
    const { data, error } = await client.rpc('get_my_entitlement', { p_feature_key: 'dashboard_advanced' }).single()
    if (error) throw new Error(`get_my_entitlement falhou: ${error.message}`)
    return data as EntitlementRow
  }

  async function setupUserWithRealProSubscription(label: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: billingCustomer.stripeCustomerId })
    await stripe.customers.update(billingCustomer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: proMonthBrlPriceId }] })
    await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_5_9c')

    const client = await signInAsDisposableUser(env, user)
    return { user, client, subscription }
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('collection_items').delete().eq('user_id', user.id)
    await admin.from('benefit_grants').delete().eq('user_id', user.id)
    await admin.from('subscriptions').delete().eq('user_id', user.id)
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  it('Free: dashboard_advanced enabled=false', async () => {
    const user = await createDisposableUser(admin, 'dash-free')
    const client = await signInAsDisposableUser(env, user)
    try {
      const entitlement = await getDashboardAdvancedEntitlement(client)
      expect(entitlement.enabled).toBe(false)
      expect(entitlement.plan_slug).toBe('free')
    } finally {
      await teardownUser(user)
    }
  })

  it('Pro (assinatura real ativa): dashboard_advanced enabled=true', async () => {
    const { user, client } = await setupUserWithRealProSubscription('dash-pro')
    try {
      const entitlement = await getDashboardAdvancedEntitlement(client)
      expect(entitlement.enabled).toBe(true)
      expect(entitlement.plan_slug).toBe('pro')
    } finally {
      await teardownUser(user)
    }
  })

  it('Premium (courtesy): dashboard_advanced enabled=true — mesmo dashboard do Pro, nada extra', async () => {
    const user = await createDisposableUser(admin, 'dash-premium-courtesy')
    const client = await signInAsDisposableUser(env, user)
    try {
      const { error: grantError } = await admin.from('benefit_grants').insert({ user_id: user.id, type: 'courtesy', plan: 'premium', reason: 'teste 5.9C', created_by: user.id })
      if (grantError) throw new Error(`courtesy grant falhou: ${grantError.message}`)

      const entitlement = await getDashboardAdvancedEntitlement(client)
      expect(entitlement.enabled).toBe(true)
      expect(entitlement.plan_slug).toBe('premium')
    } finally {
      await teardownUser(user)
    }
  })

  it('Courtesy Pro (sem Stripe): dashboard_advanced enabled=true', async () => {
    const user = await createDisposableUser(admin, 'dash-courtesy-pro')
    const client = await signInAsDisposableUser(env, user)
    try {
      const { error: grantError } = await admin.from('benefit_grants').insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste 5.9C', created_by: user.id })
      if (grantError) throw new Error(`courtesy grant falhou: ${grantError.message}`)

      const entitlement = await getDashboardAdvancedEntitlement(client)
      expect(entitlement.enabled).toBe(true)
    } finally {
      await teardownUser(user)
    }
  })

  it('Pro com cancel_at_period_end=true: dashboard_advanced continua enabled=true enquanto status permanecer active', async () => {
    const { user, client, subscription } = await setupUserWithRealProSubscription('dash-pro-cape')
    try {
      await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })
      await syncSubscriptionFromStripe(admin, stripe, subscription.id, null)

      const { data: subRow } = await admin.from('subscriptions').select('status, cancel_at_period_end').eq('stripe_subscription_id', subscription.id).single()
      expect(subRow?.status).toBe('active')
      expect(subRow?.cancel_at_period_end).toBe(true)

      const entitlement = await getDashboardAdvancedEntitlement(client)
      expect(entitlement.enabled).toBe(true)
    } finally {
      await teardownUser(user)
    }
  })

  it('Após cancelamento efetivo: plano vira free, dashboard_advanced volta a enabled=false', async () => {
    const { user, client, subscription } = await setupUserWithRealProSubscription('dash-pro-then-free')
    try {
      await stripe.subscriptions.cancel(subscription.id)
      await syncSubscriptionFromStripe(admin, stripe, subscription.id, null)

      const entitlement = await getDashboardAdvancedEntitlement(client)
      expect(entitlement.enabled).toBe(false)
      expect(entitlement.plan_slug).toBe('free')
    } finally {
      await teardownUser(user)
    }
  })

  it('Isolamento: usuário A nunca acessa collection_units/purchases de B (RLS pré-existente, inalterada pela Etapa 5.9C)', async () => {
    const userA = await createDisposableUser(admin, 'dash-isolation-a')
    const userB = await createDisposableUser(admin, 'dash-isolation-b')
    const clientA = await signInAsDisposableUser(env, userA)
    try {
      const { data: itemB, error: itemError } = await admin.from('collection_items').insert({ user_id: userB.id, country_code: 'BR', year: 2020, denomination: 'item de B' }).select('id').single()
      if (itemError || !itemB) throw new Error(`setup falhou: ${itemError?.message}`)
      await admin.from('collection_units').insert({ collection_item_id: itemB.id, is_primary: true, cost_type: 'unknown' })

      // Mesma forma de query usada pela seção "Resumo"/"Distribuição" do Dashboard.
      const { data: itemsSeenByA, error: itemsError } = await clientA
        .from('collection_items')
        .select('quantity, country_code, metal_code')
        .is('deleted_at', null)
      expect(itemsError).toBeNull()
      expect((itemsSeenByA ?? []).length).toBe(0) // A não tem nenhum item — nunca vê o de B

      const { data: unitsSeenByA, error: unitsError } = await clientA
        .from('collection_units')
        .select('unit_cost, purchase_id, collection_item_id, collection_items!inner ( id, denomination, deleted_at )')
        .is('collection_items.deleted_at', null)
      expect(unitsError).toBeNull()
      expect((unitsSeenByA ?? []).length).toBe(0) // idem para exemplares
    } finally {
      await teardownUser(userA)
      await teardownUser(userB)
    }
  })

  it('Regressão — a query de collection_items com os embeds usados pelo Dashboard continua funcionando (nada foi removido)', async () => {
    const user = await createDisposableUser(admin, 'dash-query-shape')
    const client = await signInAsDisposableUser(env, user)
    try {
      const { data: item, error: itemError } = await admin.from('collection_items').insert({ user_id: user.id, country_code: 'BR', year: 2020, denomination: 'moeda teste shape' }).select('id').single()
      if (itemError || !item) throw new Error(`setup falhou: ${itemError?.message}`)
      await admin.from('collection_units').insert({ collection_item_id: item.id, is_primary: true, cost_type: 'unknown' })

      // Exatamente a mesma seleção de app/dashboard/page.tsx (Resumo/Distribuição).
      const { data, error } = await client
        .from('collection_items')
        .select('quantity, country_code, metal_code, countries ( name, flag_emoji ), metals!metal_code ( name ), collection_units ( status, grade_id, grades ( label ) )')
        .is('deleted_at', null)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data?.[0]?.country_code).toBe('BR')
    } finally {
      await teardownUser(user)
    }
  })
})
