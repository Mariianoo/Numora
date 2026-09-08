/**
 * tests/integration/stripe-subscription-sync.test.ts
 * Etapa "Stripe 5.4B — Subscription Sync" — prova, contra Supabase DEV
 * real, que `syncSubscriptionFromStripe` sincroniza corretamente
 * subscriptions REAIS do Stripe TEST MODE.
 *
 * PROVA MANUAL ADICIONAL (fora deste arquivo, não repetida aqui por ser
 * lenta/frágil demais para rodar 2x a cada regressão): um Checkout Session
 * real (Stripe 5.3) foi aberto no browser e completado com o cartão de
 * teste oficial do Stripe (4242 4242 4242 4242), gerando uma subscription
 * real; `syncSubscriptionFromStripe` sincronizou corretamente
 * user_id/billing_customer_id/stripe_price_id/plan_id('pro')/status
 * ('active'), e `get_effective_plan()` confirmou o Pro concedido. Tudo
 * limpo depois (subscription cancelada, Customer removido). Resultado
 * exato documentado no relatório desta etapa.
 *
 * Este arquivo cria subscriptions reais DIRETO via
 * `stripe.subscriptions.create()` (em vez de completar um Checkout no
 * browser a cada teste) usando o payment method de teste oficial do
 * Stripe (`pm_card_visa`) — mais rápido e determinístico para rodar 2x a
 * cada regressão, produz uma subscription IGUALMENTE real em TEST MODE.
 * `syncSubscriptionFromStripe` sempre chama `stripe.subscriptions.retrieve()`
 * de verdade — o "atalho de criação" não afeta em nada o que está sendo
 * testado (a camada de SYNC, não a de Checkout, já coberta na Stripe 5.3).
 *
 * Cenários que exigiriam criar um Price novo no Stripe (grandfathering
 * real com 2 Prices distintos) ou forçar `past_due` sem esperar um ciclo
 * de cobrança real são tratados com Stripe MOCKADO + DB real (documentado
 * em cada teste) — nunca alteramos/criamos Products/Prices reais.
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

describe.skipIf(!hasTestEnv())('Subscription sync (DEV real + Stripe TEST real) — Stripe 5.4B', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  let proMonthBrlPriceId: string
  let premiumMonthBrlPriceId: string
  const createdStripeCustomerIds = new Set<string>()
  const createdStripeSubscriptionIds = new Set<string>()

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()

    const { data: pro } = await admin.from('plan_prices').select('stripe_price_id, plans:plan_id(slug)').eq('interval', 'month').eq('currency', 'BRL').eq('active', true)
    for (const row of pro ?? []) {
      const slug = Array.isArray(row.plans) ? row.plans[0]?.slug : (row.plans as { slug: string } | null)?.slug
      if (slug === 'pro') proMonthBrlPriceId = row.stripe_price_id as string
      if (slug === 'premium') premiumMonthBrlPriceId = row.stripe_price_id as string
    }
  })

  afterAll(async () => {
    await Promise.allSettled(
      Array.from(createdStripeSubscriptionIds).map((id) => stripe.subscriptions.cancel(id).catch(() => undefined)),
    )
    await Promise.allSettled(
      Array.from(createdStripeCustomerIds).map((id) => stripe.customers.del(id).catch(() => undefined)),
    )
  }, 60_000)

  async function setupUserWithRealCustomer(label: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)
    return { user, stripeCustomerId: billingCustomer.stripeCustomerId }
  }

  async function attachTestPaymentMethod(stripeCustomerId: string): Promise<void> {
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomerId })
    await stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
  }

  /** Cria uma subscription REAL no Stripe TEST direto (sem passar pela página de Checkout) — ver cabeçalho do arquivo. */
  async function createRealSubscription(stripeCustomerId: string, priceId: string, extra: Partial<Stripe.SubscriptionCreateParams> = {}): Promise<Stripe.Subscription> {
    await attachTestPaymentMethod(stripeCustomerId)
    const subscription = await stripe.subscriptions.create({ customer: stripeCustomerId, items: [{ price: priceId }], ...extra })
    createdStripeSubscriptionIds.add(subscription.id)
    return subscription
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('subscriptions').delete().eq('user_id', user.id)
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  describe('FASE 28/38 — subscription real ativa, sync e effective_plans()', () => {
    it('sincroniza corretamente user/customer/price/plan/status e effective_plans() concede Pro', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-active')
      try {
        const subscription = await createRealSubscription(stripeCustomerId, proMonthBrlPriceId)
        expect(subscription.status).toBe('active')

        const result = await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_active')
        expect(result).toMatchObject({ outcome: 'synced', previousStatus: null, newStatus: 'active', transitionRecorded: true })

        const { data: row } = await admin
          .from('subscriptions')
          .select('user_id, billing_customer_id, stripe_subscription_id, stripe_price_id, status')
          .eq('stripe_subscription_id', subscription.id)
          .single()
        expect(row?.user_id).toBe(user.id)
        expect(row?.stripe_price_id).toBe(proMonthBrlPriceId)
        expect(row?.status).toBe('active')

        const { data: effective } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effective?.[0]?.plan_slug).toBe('pro')
        expect(effective?.[0]?.source).toBe('subscription')
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 29 — trialing', () => {
    it('subscription em trial: status=trialing, trial_end preenchido, effective_plans() concede acesso', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-trialing')
      try {
        const subscription = await createRealSubscription(stripeCustomerId, premiumMonthBrlPriceId, { trial_period_days: 14 })
        expect(subscription.status).toBe('trialing')

        await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_trial')

        const { data: row } = await admin.from('subscriptions').select('status, trial_end').eq('stripe_subscription_id', subscription.id).single()
        expect(row?.status).toBe('trialing')
        expect(row?.trial_end).not.toBeNull()

        const { data: effective } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effective?.[0]?.plan_slug).toBe('premium')
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 19/32 — cancel_at_period_end distinto de canceled', () => {
    it('cancel_at_period_end=true com status=active continua concedendo acesso; status=canceled remove o acesso', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-cancel-at-period-end')
      try {
        const subscription = await createRealSubscription(stripeCustomerId, proMonthBrlPriceId)
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_created')

        await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_cancel_at_period_end')

        const { data: rowBefore } = await admin.from('subscriptions').select('status, cancel_at_period_end').eq('stripe_subscription_id', subscription.id).single()
        expect(rowBefore?.status).toBe('active')
        expect(rowBefore?.cancel_at_period_end).toBe(true)

        const { data: effectiveBefore } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effectiveBefore?.[0]?.plan_slug).toBe('pro') // acesso permanece enquanto status ainda é active

        await stripe.subscriptions.cancel(subscription.id)
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_deleted')

        const { data: rowAfter } = await admin.from('subscriptions').select('status').eq('stripe_subscription_id', subscription.id).single()
        expect(rowAfter?.status).toBe('canceled')

        const { data: effectiveAfter } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effectiveAfter?.[0]?.plan_slug).toBe('free') // effective_plans() não foi alterada — deriva ao vivo do status
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 17/31 — eventos fora de ordem: canonical state sempre vence', () => {
    it('um "evento antigo" sincronizado DEPOIS de um cancelamento real nunca ressuscita a subscription', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-out-of-order')
      try {
        const subscription = await createRealSubscription(stripeCustomerId, proMonthBrlPriceId)
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_created')

        await stripe.subscriptions.cancel(subscription.id)
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_deleted')

        // Simula a entrega tardia de um evento "customer.subscription.updated"
        // antigo (de antes do cancelamento) chegando só agora — sync sempre
        // busca o estado canônico ATUAL, nunca confia em payload de evento.
        const lateResult = await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_late_update')

        expect(lateResult.newStatus).toBe('canceled')
        const { data: row } = await admin.from('subscriptions').select('status').eq('stripe_subscription_id', subscription.id).single()
        expect(row?.status).toBe('canceled') // nunca voltou a active
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 33 — replay do mesmo evento', () => {
    it('sincronizar a mesma subscription 2x seguidas: 1 linha, transição registrada só na primeira vez', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-replay')
      try {
        const subscription = await createRealSubscription(stripeCustomerId, proMonthBrlPriceId)

        const first = await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_replay')
        const second = await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_replay')

        expect(first.transitionRecorded).toBe(true)
        expect(second.transitionRecorded).toBe(false) // status não mudou entre as duas chamadas

        const { data: rows } = await admin.from('subscriptions').select('id').eq('stripe_subscription_id', subscription.id)
        expect(rows).toHaveLength(1)

        const { data: events } = await admin.from('subscription_events').select('id').eq('subscription_id', rows![0].id)
        expect(events).toHaveLength(1) // nenhuma transição duplicada
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 34 — concorrência: 2 sincronizações simultâneas da mesma subscription NOVA', () => {
    it('exatamente 1 linha local ao final; pelo menos uma chamada é bem-sucedida', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-concurrency')
      try {
        const subscription = await createRealSubscription(stripeCustomerId, proMonthBrlPriceId)

        const results = await Promise.allSettled([
          syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_concurrent_a'),
          syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_concurrent_b'),
        ])

        const fulfilled = results.filter((r) => r.status === 'fulfilled')
        expect(fulfilled.length).toBeGreaterThanOrEqual(1) // "um processamento efetivo" — a outra pode falhar por 23505 e ser retentada depois

        const { data: rows } = await admin.from('subscriptions').select('id').eq('stripe_subscription_id', subscription.id)
        expect(rows).toHaveLength(1) // NUNCA duas linhas para a mesma subscription Stripe
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 22/23 — constraint da Stripe 5.1: duplicidade de subscription elegível', () => {
    it('usuário já com uma subscription active: uma SEGUNDA subscription real elegível falha explicitamente ao sincronizar', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('sync-duplicity')
      try {
        const subscriptionA = await createRealSubscription(stripeCustomerId, proMonthBrlPriceId)
        await syncSubscriptionFromStripe(admin, stripe, subscriptionA.id, 'evt_test_dup_a')

        const subscriptionB = await createRealSubscription(stripeCustomerId, premiumMonthBrlPriceId)
        await expect(syncSubscriptionFromStripe(admin, stripe, subscriptionB.id, 'evt_test_dup_b')).rejects.toThrow()

        // A subscription A original nunca foi alterada/removida para "abrir espaço".
        const { data: rowA } = await admin.from('subscriptions').select('status').eq('stripe_subscription_id', subscriptionA.id).single()
        expect(rowA?.status).toBe('active')

        const { data: rowB } = await admin.from('subscriptions').select('id').eq('stripe_subscription_id', subscriptionB.id)
        expect(rowB).toEqual([]) // subscription B nunca foi persistida localmente
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 25/36 — Customer desconhecido / isolamento entre usuários', () => {
    it('Stripe Customer sem billing_customer local: falha explícita, nunca associa a outro usuário', async () => {
      // Customer real, criado DIRETO no Stripe (nunca via getOrCreateBillingCustomer)
      // — de propósito sem nenhum vínculo local, para provar a rejeição.
      const orphanCustomer = await stripe.customers.create({ email: `numora.test.orphan.${Date.now()}@example.com` })
      createdStripeCustomerIds.add(orphanCustomer.id)
      const subscription = await createRealSubscription(orphanCustomer.id, proMonthBrlPriceId)

      await expect(syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_orphan')).rejects.toThrow(/não tem billing_customer local vinculado/)

      const { data: rows } = await admin.from('subscriptions').select('id').eq('stripe_subscription_id', subscription.id)
      expect(rows).toEqual([])
    })

    it('usuário A e usuário B: subscriptions nunca se cruzam', async () => {
      const a = await setupUserWithRealCustomer('sync-isolation-a')
      const b = await setupUserWithRealCustomer('sync-isolation-b')
      try {
        const subA = await createRealSubscription(a.stripeCustomerId, proMonthBrlPriceId)
        const subB = await createRealSubscription(b.stripeCustomerId, premiumMonthBrlPriceId)

        await syncSubscriptionFromStripe(admin, stripe, subA.id, 'evt_test_iso_a')
        await syncSubscriptionFromStripe(admin, stripe, subB.id, 'evt_test_iso_b')

        const { data: rowA } = await admin.from('subscriptions').select('user_id').eq('stripe_subscription_id', subA.id).single()
        const { data: rowB } = await admin.from('subscriptions').select('user_id').eq('stripe_subscription_id', subB.id).single()
        expect(rowA?.user_id).toBe(a.user.id)
        expect(rowB?.user_id).toBe(b.user.id)
        expect(rowA?.user_id).not.toBe(rowB?.user_id)
      } finally {
        await teardownUser(a.user)
        await teardownUser(b.user)
      }
    })
  })

  describe('FASE 35 — retry após falha', () => {
    it('sync falha (Customer inexistente) e depois é corrigido (vínculo criado): retry sincroniza com sucesso, sem duplicar', async () => {
      const user = await createDisposableUser(admin, 'sync-retry')
      try {
        const customer = await stripe.customers.create({ email: user.email })
        createdStripeCustomerIds.add(customer.id)
        const subscription = await createRealSubscription(customer.id, proMonthBrlPriceId)

        // 1ª tentativa: falha de propósito (ainda sem billing_customer local).
        await expect(syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_retry')).rejects.toThrow()

        // Corrige a causa raiz (equivalente ao que a Stripe 5.2 faria) e reprocessa o MESMO evento.
        const { data: bc } = await admin.from('billing_customers').insert({ user_id: user.id, stripe_customer_id: customer.id }).select('id').single()

        const retryResult = await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_retry')
        expect(retryResult.outcome).toBe('synced')

        const { data: rows } = await admin.from('subscriptions').select('id').eq('stripe_subscription_id', subscription.id)
        expect(rows).toHaveLength(1)

        await admin.from('subscriptions').delete().eq('id', bc!.id) // no-op seguro caso já tenha cascade; mantém symmetry com teardown abaixo
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 24 — Price integrity (grandfathering e Price desconhecido — DB real, Stripe mockado)', () => {
    it('grandfathering: plan_prices histórico/inativo continua resolvendo o plan_id correto, nunca é substituído pelo preço ativo atual', async () => {
      // Criar um SEGUNDO Price real no Stripe é proibido nesta etapa — este
      // teste usa um plano DESCARTÁVEL com 2 linhas locais (histórica
      // inativa "Price A" + atual ativa "Price B" para a mesma combinação)
      // e um Stripe MOCKADO cujo retrieve() aponta para "Price A" — prova
      // que a resolução nunca escorrega para a linha ativa da mesma combinação.
      const suffix = Date.now().toString().slice(-8)
      const { data: plan } = await admin.from('plans').insert({ name: 'Teste Stripe 5.4B', slug: `test-stripe54b-${suffix}`, active: false }).select('id').single()
      const planId = plan!.id as string

      const historicalStripePriceId = `price_test54b_historical_${suffix}`
      const currentStripePriceId = `price_test54b_current_${suffix}`
      await admin.from('plan_prices').insert({
        plan_id: planId,
        interval: 'month',
        amount: 19.9,
        currency: 'BRL',
        active: false,
        stripe_price_id: historicalStripePriceId,
        effective_from: '2026-01-01T00:00:00Z',
        effective_until: '2026-06-01T00:00:00Z',
      })
      await admin.from('plan_prices').insert({
        plan_id: planId,
        interval: 'month',
        amount: 24.9,
        currency: 'BRL',
        active: true,
        stripe_price_id: currentStripePriceId,
      })

      const user = await createDisposableUser(admin, 'sync-grandfathering')
      try {
        const { data: bc } = await admin.from('billing_customers').insert({ user_id: user.id, stripe_customer_id: `cus_test54b_${suffix}` }).select('id').single()

        const fakeSubscription = {
          id: `sub_test54b_${suffix}`,
          customer: `cus_test54b_${suffix}`,
          status: 'active',
          cancel_at_period_end: false,
          canceled_at: null,
          trial_end: null,
          metadata: {},
          items: { data: [{ price: { id: historicalStripePriceId }, current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] },
        } as unknown as Stripe.Subscription
        const mockStripe = { subscriptions: { retrieve: async () => fakeSubscription } } as unknown as Stripe

        const result = await syncSubscriptionFromStripe(admin, mockStripe, fakeSubscription.id, 'evt_test_grandfathering')
        expect(result.outcome).toBe('synced')

        const { data: row } = await admin.from('subscriptions').select('stripe_price_id, plan_id').eq('stripe_subscription_id', fakeSubscription.id).single()
        expect(row?.stripe_price_id).toBe(historicalStripePriceId) // NUNCA trocado pelo currentStripePriceId
        expect(row?.plan_id).toBe(planId)

        await admin.from('subscriptions').delete().eq('stripe_subscription_id', fakeSubscription.id)
        await admin.from('billing_customers').delete().eq('id', bc!.id)
      } finally {
        await admin.from('plan_prices').delete().eq('plan_id', planId)
        await admin.from('plans').delete().eq('id', planId)
        await deleteDisposableUser(admin, user.id)
      }
    })

    it('Stripe Price desconhecido localmente: falha explícita (Stripe mockado, DB real)', async () => {
      const user = await createDisposableUser(admin, 'sync-unknown-price')
      try {
        const stripeCustomerId = `cus_test54b_unknownprice_${Date.now()}`
        const { data: bc } = await admin.from('billing_customers').insert({ user_id: user.id, stripe_customer_id: stripeCustomerId }).select('id').single()

        const fakeSubscription = {
          id: `sub_test54b_unknownprice_${Date.now()}`,
          customer: stripeCustomerId,
          status: 'active',
          cancel_at_period_end: false,
          canceled_at: null,
          trial_end: null,
          metadata: {},
          items: { data: [{ price: { id: 'price_que_nunca_existiu_localmente' }, current_period_start: 1, current_period_end: 2 }] },
        } as unknown as Stripe.Subscription
        const mockStripe = { subscriptions: { retrieve: async () => fakeSubscription } } as unknown as Stripe

        await expect(syncSubscriptionFromStripe(admin, mockStripe, fakeSubscription.id, 'evt_test_unknown_price')).rejects.toThrow(/não corresponde a nenhuma linha local de plan_prices/)

        await admin.from('billing_customers').delete().eq('id', bc!.id)
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })
  })

  describe('FASE 37 — RLS não foi enfraquecida', () => {
    it('usuário comum não escreve em subscriptions/subscription_events diretamente', async () => {
      const user = await createDisposableUser(admin, 'sync-rls')
      try {
        const userClient = await signInAsDisposableUser(env, user)

        const { error: subsInsertError } = await userClient.from('subscriptions').insert({
          user_id: user.id,
          billing_customer_id: '00000000-0000-0000-0000-000000000000',
          stripe_subscription_id: `sub_should_not_work_${Date.now()}`,
          plan_id: '00000000-0000-0000-0000-000000000000',
          status: 'active',
        })
        expect(subsInsertError).not.toBeNull()

        const { error: eventsInsertError } = await userClient
          .from('subscription_events')
          .insert({ subscription_id: '00000000-0000-0000-0000-000000000000', to_status: 'active', source: 'webhook' })
        expect(eventsInsertError).not.toBeNull()
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })
  })
})
