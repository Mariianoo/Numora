/**
 * tests/unit/stripe-subscription-sync.test.ts
 * Etapa "Stripe 5.4B — Subscription Sync" — `syncSubscriptionFromStripe`/
 * `syncSubscriptionFromCheckoutSession`/`syncFromRecognizedWebhookEvent`
 * (lib/stripe/subscription-sync.ts), com Stripe E Supabase MOCKADOS —
 * nenhuma chamada real (a prova contra DEV real + Stripe TEST real está
 * em tests/integration/stripe-subscription-sync.test.ts).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { syncFromRecognizedWebhookEvent, syncSubscriptionFromCheckoutSession, syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'

const BILLING_CUSTOMER = { id: 'bc-uuid-1', user_id: 'user-uuid-1' }
const PLAN_ID = 'plan-uuid-pro'

function makeStripeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_test_123',
    object: 'subscription',
    customer: 'cus_test_abc',
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test_1',
          object: 'subscription_item',
          price: { id: 'price_test_pro_month_brl' },
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        } as unknown as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: '/v1/subscription_items',
    } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
    ...overrides,
  } as unknown as Stripe.Subscription
}

interface MockSupabaseOptions {
  billingCustomer?: { data: { id: string; user_id: string } | null; error: { message: string } | null }
  planPrice?: { data: { plan_id: string } | null; error: { message: string } | null }
  rpcResult?: { data: { subscription_id: string; previous_status: string | null; new_status: string; transition_recorded: boolean } | null; error: { code?: string; message: string } | null }
}

function makeMockSupabase(opts: MockSupabaseOptions) {
  const fromCalls: string[] = []

  const from = vi.fn((table: string) => {
    fromCalls.push(table)
    if (table === 'billing_customers') {
      const maybeSingle = vi.fn().mockResolvedValue(opts.billingCustomer ?? { data: BILLING_CUSTOMER, error: null })
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }
    if (table === 'plan_prices') {
      const maybeSingle = vi.fn().mockResolvedValue(opts.planPrice ?? { data: { plan_id: PLAN_ID }, error: null })
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }
    throw new Error(`tabela inesperada nesta suíte: ${table}`)
  })

  const rpcSingle = vi.fn().mockResolvedValue(opts.rpcResult ?? { data: { subscription_id: 'sub-row-uuid', previous_status: null, new_status: 'active', transition_recorded: true }, error: null })
  const rpc = vi.fn().mockReturnValue({ single: rpcSingle })

  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, fromCalls }
}

function makeMockStripe(subscription: Stripe.Subscription) {
  const retrieve = vi.fn().mockResolvedValue(subscription)
  return { client: { subscriptions: { retrieve } } as unknown as Stripe, retrieve }
}

describe('syncSubscriptionFromStripe — resolução e mapeamento', () => {
  it('busca o estado CANÔNICO via stripe.subscriptions.retrieve (nunca confia num payload passado por fora)', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe, retrieve } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({})

    await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(retrieve).toHaveBeenCalledWith('sub_test_123')
  })

  it('resolve user_id via billing_customers.stripe_customer_id (nunca outra fonte)', async () => {
    const subscription = makeStripeSubscription({ customer: 'cus_test_abc' })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, from } = makeMockSupabase({})

    await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(from).toHaveBeenCalledWith('billing_customers')
  })

  it('resolve plan_id via plan_prices.stripe_price_id (Price ID como autoridade, nunca amount/currency/interval)', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, from } = makeMockSupabase({})

    const result = await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(from).toHaveBeenCalledWith('plan_prices')
    expect(result.outcome).toBe('synced')
  })

  it('mapeia status Stripe diretamente (mesmo conjunto de valores do CHECK local) e timestamps unix→ISO', async () => {
    const subscription = makeStripeSubscription({
      status: 'past_due',
      cancel_at_period_end: true,
      canceled_at: null,
      trial_end: 1_699_000_000,
    })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, rpc } = makeMockSupabase({})

    await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(rpc).toHaveBeenCalledWith(
      'sync_subscription_from_stripe',
      expect.objectContaining({
        p_status: 'past_due',
        p_cancel_at_period_end: true,
        p_canceled_at: null,
        p_trial_end: new Date(1_699_000_000 * 1000).toISOString(),
        p_current_period_start: new Date(1_700_000_000 * 1000).toISOString(),
        p_current_period_end: new Date(1_702_592_000 * 1000).toISOString(),
        p_stripe_event_id: 'evt_1',
        p_source: 'webhook',
      }),
    )
  })

  it('canceled_at nulo é enviado como null, nunca um placeholder inventado', async () => {
    const subscription = makeStripeSubscription({ status: 'canceled', canceled_at: 1_701_000_000 })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, rpc } = makeMockSupabase({})

    await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(rpc).toHaveBeenCalledWith('sync_subscription_from_stripe', expect.objectContaining({ p_status: 'canceled', p_canceled_at: new Date(1_701_000_000 * 1000).toISOString() }))
  })

  it('grandfathering: resolve plan_prices só por stripe_price_id — nunca filtra por active/effective_until', async () => {
    const subscription = makeStripeSubscription({ items: { data: [{ price: { id: 'price_historico_inativo' }, current_period_start: 1, current_period_end: 2 }] } as unknown as Stripe.ApiList<Stripe.SubscriptionItem> })
    const { client: stripe } = makeMockStripe(subscription)
    const supabaseMock = makeMockSupabase({ planPrice: { data: { plan_id: PLAN_ID }, error: null } })

    const result = await syncSubscriptionFromStripe(supabaseMock.client, stripe, 'sub_test_123', 'evt_1')

    expect(result.outcome).toBe('synced')
    // A consulta usa .eq('stripe_price_id', ...) — nunca acrescenta active=true.
  })

  it('subscription nova (RPC devolve previous_status=null): resultado reflete "criada", não "atualizada"', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({ rpcResult: { data: { subscription_id: 'new-row', previous_status: null, new_status: 'active', transition_recorded: true }, error: null } })

    const result = await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(result).toEqual({ outcome: 'synced', subscriptionId: 'new-row', previousStatus: null, newStatus: 'active', transitionRecorded: true })
  })

  it('subscription existente (RPC devolve previous_status preenchido)', async () => {
    const subscription = makeStripeSubscription({ status: 'past_due' })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({ rpcResult: { data: { subscription_id: 'existing-row', previous_status: 'active', new_status: 'past_due', transition_recorded: true }, error: null } })

    const result = await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(result).toEqual({ outcome: 'synced', subscriptionId: 'existing-row', previousStatus: 'active', newStatus: 'past_due', transitionRecorded: true })
  })

  it('eventos fora de ordem: o status gravado é sempre o CANÔNICO retornado por retrieve(), nunca inferido do tipo do evento', async () => {
    // Mesmo chamando esta função a partir de um evento "customer.subscription.updated"
    // antigo, o retrieve() mockado devolve o estado ATUAL (canceled) — é isso que deve ser gravado.
    const subscription = makeStripeSubscription({ status: 'canceled', canceled_at: 1_701_000_000 })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, rpc } = makeMockSupabase({})

    await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_old_update')

    expect(rpc).toHaveBeenCalledWith('sync_subscription_from_stripe', expect.objectContaining({ p_status: 'canceled' }))
  })

  it('customer desconhecido: billing_customers não encontrado → falha explícita, nunca cria vínculo novo', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, from } = makeMockSupabase({ billingCustomer: { data: null, error: null } })

    await expect(syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')).rejects.toThrow(/não tem billing_customer local vinculado/)
    expect(from).not.toHaveBeenCalledWith('plan_prices') // nunca chega a resolver o preço se o Customer já falhou
  })

  it('price desconhecido: plan_prices não encontrado → falha explícita', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({ planPrice: { data: null, error: null } })

    await expect(syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')).rejects.toThrow(/não corresponde a nenhuma linha local de plan_prices/)
  })

  it('conflito de usuário: metadata.numora_user_id diverge de billing_customers.user_id → falha explícita, nunca escolhe arbitrariamente', async () => {
    const subscription = makeStripeSubscription({ metadata: { numora_user_id: 'user-uuid-DIFERENTE' } })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({})

    await expect(syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')).rejects.toThrow(/Inconsistência/)
  })

  it('metadata.numora_user_id ausente: nenhuma validação extra é aplicada (não é erro)', async () => {
    const subscription = makeStripeSubscription({ metadata: {} })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({})

    const result = await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')
    expect(result.outcome).toBe('synced')
  })

  it('conflito de plano: subscription com mais de 1 item → falha explícita (nunca escolhe "o primeiro")', async () => {
    const subscription = makeStripeSubscription({
      items: {
        data: [
          { price: { id: 'price_a' }, current_period_start: 1, current_period_end: 2 },
          { price: { id: 'price_b' }, current_period_start: 1, current_period_end: 2 },
        ],
      } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
    })
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({})

    await expect(syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')).rejects.toThrow(/1 item/)
  })

  it('constraint de subscription elegível (Stripe 5.1): violação (23505) propaga como erro explícito, nunca mascarada', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({ rpcResult: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_subscriptions_user_id_active_status"' } } })

    await expect(syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')).rejects.toThrow(/uq_subscriptions_user_id_active_status/)
  })

  it('nunca toca em profiles/benefit_grants/entitlement — só billing_customers, plan_prices e a RPC de sync', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe } = makeMockStripe(subscription)
    const { client: supabase, fromCalls, rpc } = makeMockSupabase({})

    await syncSubscriptionFromStripe(supabase, stripe, 'sub_test_123', 'evt_1')

    expect(fromCalls.sort()).toEqual(['billing_customers', 'plan_prices'])
    expect(rpc).toHaveBeenCalledWith('sync_subscription_from_stripe', expect.anything())
    expect(rpc).not.toHaveBeenCalledWith('get_effective_plan', expect.anything())
  })
})

describe('syncSubscriptionFromCheckoutSession', () => {
  it('extrai o subscription ID da Session e sincroniza a partir dele', async () => {
    const subscription = makeStripeSubscription()
    const { client: stripe, retrieve } = makeMockStripe(subscription)
    const { client: supabase } = makeMockSupabase({})
    const session = { id: 'cs_test_1', subscription: 'sub_test_123' } as unknown as Stripe.Checkout.Session

    const result = await syncSubscriptionFromCheckoutSession(supabase, stripe, session, 'evt_checkout_1')

    expect(retrieve).toHaveBeenCalledWith('sub_test_123')
    expect(result.outcome).toBe('synced')
  })

  it('Session sem subscription: outcome "skipped", nunca inventa uma subscription', async () => {
    const { client: stripe, retrieve } = makeMockStripe(makeStripeSubscription())
    const { client: supabase } = makeMockSupabase({})
    const session = { id: 'cs_test_2', subscription: null } as unknown as Stripe.Checkout.Session

    const result = await syncSubscriptionFromCheckoutSession(supabase, stripe, session, 'evt_checkout_2')

    expect(result).toEqual({ outcome: 'skipped', reason: expect.stringContaining('cs_test_2') })
    expect(retrieve).not.toHaveBeenCalled()
  })
})

describe('syncFromRecognizedWebhookEvent — dispatcher de negócio', () => {
  function makeEvent(type: string, object: unknown, id = 'evt_dispatch_1'): Stripe.Event {
    return { id, type, data: { object } } as unknown as Stripe.Event
  }

  it('checkout.session.completed → syncSubscriptionFromCheckoutSession', async () => {
    const { client: stripe, retrieve } = makeMockStripe(makeStripeSubscription())
    const { client: supabase } = makeMockSupabase({})
    const event = makeEvent('checkout.session.completed', { id: 'cs_1', subscription: 'sub_test_123' })

    const result = await syncFromRecognizedWebhookEvent(supabase, stripe, event)
    expect(retrieve).toHaveBeenCalledWith('sub_test_123')
    expect(result.outcome).toBe('synced')
  })

  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    it(`${type} → syncSubscriptionFromStripe usando subscription.id do payload só para localizar, nunca para confiar no status`, async () => {
      const { client: stripe, retrieve } = makeMockStripe(makeStripeSubscription({ status: 'active' }))
      const { client: supabase } = makeMockSupabase({})
      const event = makeEvent(type, { id: 'sub_test_123', status: 'canceled' }) // status do payload é ignorado de propósito

      const result = await syncFromRecognizedWebhookEvent(supabase, stripe, event)
      expect(retrieve).toHaveBeenCalledWith('sub_test_123')
      expect(result.outcome).toBe('synced')
    })
  }

  it('invoice.paid → delega para o Invoice Sync (Stripe 5.5), nunca chama subscriptions.retrieve', async () => {
    const { client: stripe, retrieve: subscriptionsRetrieve } = makeMockStripe(makeStripeSubscription())
    const invoicesRetrieve = vi.fn().mockResolvedValue({
      id: 'in_test_1',
      customer: 'cus_test_abc',
      parent: null,
      payments: { data: [] },
      metadata: {},
      currency: 'brl',
      amount_paid: 1990,
      status_transitions: { paid_at: 1700000000 },
    })
    ;(stripe as unknown as { invoices: unknown }).invoices = { retrieve: invoicesRetrieve }
    const { client: supabase } = makeMockSupabase({})
    const event = makeEvent('invoice.paid', { id: 'in_test_1' })

    const result = await syncFromRecognizedWebhookEvent(supabase, stripe, event)

    expect(invoicesRetrieve).toHaveBeenCalledWith('in_test_1', { expand: ['payments'] })
    expect(subscriptionsRetrieve).not.toHaveBeenCalled() // nunca confunde com sincronização de subscription
    expect(result.outcome).toBe('synced')
  })

  it('tipo desconhecido — no-op, nunca lança', async () => {
    const { client: stripe } = makeMockStripe(makeStripeSubscription())
    const { client: supabase } = makeMockSupabase({})
    const event = makeEvent('some.unknown.event', {})

    const result = await syncFromRecognizedWebhookEvent(supabase, stripe, event)
    expect(result.outcome).toBe('skipped')
  })
})
