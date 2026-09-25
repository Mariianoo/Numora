/**
 * tests/unit/stripe-subscription-management.test.ts
 * Etapa "Stripe 5.6 — Customer Portal / Gestão da Assinatura" —
 * `resolveOwnedEligibleSubscription`/`cancelOwnSubscription`/`changeOwnPlan`
 * (lib/stripe/subscription-management.ts), com Stripe E Supabase
 * MOCKADOS. `getCommercialPlanPricesCatalog` (lib/stripe/catalog.ts) é
 * mockado inteiro aqui — sua própria correção já é coberta por
 * tests/unit/stripe-catalog-validation.test.ts; a prova de ponta a ponta
 * contra o catálogo REAL está em tests/integration/stripe-subscription-management.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import type { CommercialPlanPrice } from '@/lib/stripe/catalog'

const getCommercialPlanPricesCatalog = vi.fn<() => Promise<CommercialPlanPrice[]>>()
vi.mock('@/lib/stripe/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/catalog')>()
  return { ...actual, getCommercialPlanPricesCatalog: (...args: unknown[]) => getCommercialPlanPricesCatalog(...(args as [])) }
})

// Bloco A (Official Launch Foundation) — Premium é "Em breve": `changeOwnPlan`
// rejeita destino Premium antes de qualquer outra coisa (lib/billing/plan-availability.ts).
// Este arquivo cobre a MECÂNICA dormante de upgrade/moeda/preço (que volta a valer quando o
// Premium for lançado) simulando a disponibilidade; a barreira REAL, sem nenhum mock, é
// provada em tests/unit/premium-purchase-guard.test.ts.
vi.mock('@/lib/billing/plan-availability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/plan-availability')>()
  return { ...actual, isPlanPurchasable: () => true }
})

const { cancelOwnSubscription, changeOwnPlan, resolveOwnedEligibleSubscription } = await import('@/lib/stripe/subscription-management')

const PRO_MONTH_BRL: CommercialPlanPrice = { planPriceId: 'pp-pro-month-brl', planId: 'plan-pro', planSlug: 'pro', interval: 'month', currency: 'BRL', amount: 19.9, stripePriceId: 'price_pro_month_brl', active: true }
const PREMIUM_MONTH_BRL: CommercialPlanPrice = { planPriceId: 'pp-premium-month-brl', planId: 'plan-premium', planSlug: 'premium', interval: 'month', currency: 'BRL', amount: 34.9, stripePriceId: 'price_premium_month_brl', active: true }
const PREMIUM_MONTH_USD: CommercialPlanPrice = { planPriceId: 'pp-premium-month-usd', planId: 'plan-premium', planSlug: 'premium', interval: 'month', currency: 'USD', amount: 9.99, stripePriceId: 'price_premium_month_usd', active: true }

function makeMockSupabase(row: { id: string; stripe_subscription_id: string | null; stripe_price_id: string | null; plans: { slug: string } | null } | null, error: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const inFn = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ in: inFn })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as unknown as SupabaseClient, from, eq, inFn }
}

describe('resolveOwnedEligibleSubscription', () => {
  it('resolve a subscription elegível do usuário — nunca aceita o ID de fora', async () => {
    const { client: supabase, from, eq } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })

    const owned = await resolveOwnedEligibleSubscription(supabase, 'user-uuid-1')

    expect(from).toHaveBeenCalledWith('subscriptions')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-uuid-1')
    expect(owned).toEqual({ id: 'sub-uuid-1', stripeSubscriptionId: 'sub_test_123', planSlug: 'pro', stripePriceId: 'price_pro_month_brl' })
  })

  it('sem subscription elegível: falha explícita', async () => {
    const { client: supabase } = makeMockSupabase(null)
    await expect(resolveOwnedEligibleSubscription(supabase, 'user-uuid-1')).rejects.toThrow(/Nenhuma subscription elegível/)
  })

  it('erro de consulta propaga', async () => {
    const { client: supabase } = makeMockSupabase(null, { message: 'conexão perdida (simulado)' })
    await expect(resolveOwnedEligibleSubscription(supabase, 'user-uuid-1')).rejects.toThrow(/conexão perdida/)
  })

  it('plano desconhecido (nem pro nem premium): falha explícita', async () => {
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_x', plans: { slug: 'free' } })
    await expect(resolveOwnedEligibleSubscription(supabase, 'user-uuid-1')).rejects.toThrow(/não pertence a um plano pago conhecido/)
  })
})

describe('cancelOwnSubscription', () => {
  it('chama subscriptions.update com cancel_at_period_end=true — NUNCA subscriptions.cancel()', async () => {
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })
    const update = vi.fn().mockResolvedValue({ id: 'sub_test_123', cancel_at_period_end: true })
    const cancel = vi.fn()
    const stripe = { subscriptions: { update, cancel } } as unknown as Stripe

    await cancelOwnSubscription(supabase, stripe, 'user-uuid-1')

    expect(update).toHaveBeenCalledWith('sub_test_123', { cancel_at_period_end: true })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('usuário sem subscription elegível: nunca chama o Stripe', async () => {
    const { client: supabase } = makeMockSupabase(null)
    const update = vi.fn()
    const stripe = { subscriptions: { update } } as unknown as Stripe

    await expect(cancelOwnSubscription(supabase, stripe, 'user-uuid-1')).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('changeOwnPlan — upgrade Pro → Premium', () => {
  it('resolve o Price pelo catálogo local e aplica proration always_invoice — nunca cria nova subscription', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL])
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })

    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_test_123', items: { data: [{ id: 'si_test_1', price: { id: 'price_pro_month_brl' } }] } })
    const update = vi.fn().mockResolvedValue({ id: 'sub_test_123' })
    const create = vi.fn()
    const stripe = { subscriptions: { retrieve, update, create }, subscriptionSchedules: { create: vi.fn() } } as unknown as Stripe

    const result = await changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'premium', interval: 'month', currency: 'BRL' })

    expect(result).toEqual({ kind: 'upgraded', stripeSubscriptionId: 'sub_test_123' })
    expect(update).toHaveBeenCalledWith('sub_test_123', { items: [{ id: 'si_test_1', price: 'price_premium_month_brl' }], proration_behavior: 'always_invoice' })
    expect(create).not.toHaveBeenCalled()
  })

  it('subscription com mais de 1 item: falha explícita (nunca escolhe "o primeiro")', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL])
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })
    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_test_123', items: { data: [{ id: 'si_1', price: { id: 'a' } }, { id: 'si_2', price: { id: 'b' } }] } })
    const stripe = { subscriptions: { retrieve, update: vi.fn() } } as unknown as Stripe

    await expect(changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'premium', interval: 'month', currency: 'BRL' })).rejects.toThrow(/2 item/)
  })
})

describe('changeOwnPlan — downgrade Premium → Pro (Subscription Schedule)', () => {
  it('sem schedule existente: cria um novo Schedule com 2 fases (atual até current_period_end, depois Pro)', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL])
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_premium_month_brl', plans: { slug: 'premium' } })

    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_test_123', schedule: null, items: { data: [{ id: 'si_1', price: { id: 'price_premium_month_brl' } }] } })
    const scheduleCreate = vi.fn().mockResolvedValue({ id: 'sub_sched_new' })
    const scheduleRetrieve = vi.fn().mockResolvedValue({
      id: 'sub_sched_new',
      phases: [{ items: [{ price: 'price_premium_month_brl', quantity: 1 }], start_date: 1700000000, end_date: 1702592000 }],
    })
    const scheduleUpdate = vi.fn().mockResolvedValue({ id: 'sub_sched_new' })
    const stripe = {
      subscriptions: { retrieve },
      subscriptionSchedules: { create: scheduleCreate, retrieve: scheduleRetrieve, update: scheduleUpdate },
    } as unknown as Stripe

    const result = await changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'pro', interval: 'month', currency: 'BRL' })

    expect(result).toEqual({ kind: 'downgrade_scheduled', stripeSubscriptionId: 'sub_test_123', stripeScheduleId: 'sub_sched_new' })
    expect(scheduleCreate).toHaveBeenCalledWith({ from_subscription: 'sub_test_123' })
    expect(scheduleUpdate).toHaveBeenCalledWith('sub_sched_new', {
      end_behavior: 'release',
      phases: [
        { items: [{ price: 'price_premium_month_brl', quantity: 1 }], start_date: 1700000000, end_date: 1702592000 },
        { items: [{ price: 'price_pro_month_brl', quantity: 1 }] },
      ],
    })
  })

  it('com schedule JÁ existente: reutiliza (nunca cria um segundo)', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL])
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_premium_month_brl', plans: { slug: 'premium' } })

    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_test_123', schedule: 'sub_sched_existing', items: { data: [{ id: 'si_1', price: { id: 'price_premium_month_brl' } }] } })
    const scheduleCreate = vi.fn()
    const scheduleRetrieve = vi.fn().mockResolvedValue({
      id: 'sub_sched_existing',
      phases: [{ items: [{ price: 'price_premium_month_brl', quantity: 1 }], start_date: 1700000000, end_date: 1702592000 }],
    })
    const scheduleUpdate = vi.fn().mockResolvedValue({ id: 'sub_sched_existing' })
    const stripe = {
      subscriptions: { retrieve },
      subscriptionSchedules: { create: scheduleCreate, retrieve: scheduleRetrieve, update: scheduleUpdate },
    } as unknown as Stripe

    const result = await changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'pro', interval: 'month', currency: 'BRL' })

    expect(scheduleCreate).not.toHaveBeenCalled()
    expect(scheduleRetrieve).toHaveBeenCalledWith('sub_sched_existing')
    expect(result.kind).toBe('downgrade_scheduled')
    if (result.kind === 'downgrade_scheduled') {
      expect(result.stripeScheduleId).toBe('sub_sched_existing')
    }
  })
})

describe('changeOwnPlan — validações de negócio', () => {
  it('mudança de moeda é rejeitada explicitamente (BRL → USD)', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_USD])
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })
    const stripe = { subscriptions: { retrieve: vi.fn(), update: vi.fn() } } as unknown as Stripe

    await expect(changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'premium', interval: 'month', currency: 'USD' })).rejects.toThrow(/Mudança de moeda não é suportada/)
  })

  it('mesmo plano solicitado: rejeitado explicitamente (nunca é upgrade nem downgrade)', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL])
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })
    const stripe = { subscriptions: { retrieve: vi.fn(), update: vi.fn() } } as unknown as Stripe

    await expect(changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'pro', interval: 'month', currency: 'BRL' })).rejects.toThrow(/já está no plano/)
  })

  it('preço alvo inexistente/inativo no catálogo: falha explícita', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL]) // sem nenhum Premium BRL
    const { client: supabase } = makeMockSupabase({ id: 'sub-uuid-1', stripe_subscription_id: 'sub_test_123', stripe_price_id: 'price_pro_month_brl', plans: { slug: 'pro' } })
    const stripe = { subscriptions: { retrieve: vi.fn(), update: vi.fn() } } as unknown as Stripe

    await expect(changeOwnPlan(supabase, stripe, 'user-uuid-1', { planSlug: 'premium', interval: 'month', currency: 'BRL' })).rejects.toThrow(/Preço indisponível/)
  })

  it('nunca aceita priceId/customerId/subscriptionId — a assinatura da função não tem esses parâmetros', () => {
    // Prova estrutural: changeOwnPlan(supabase, stripe, userId, target) — só 4 parâmetros,
    // "target" só tem planSlug/interval/currency (garantido em tempo de compilação pelo tipo ChangePlanTarget).
    expect(changeOwnPlan.length).toBe(4)
  })
})
