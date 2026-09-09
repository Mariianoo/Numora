/**
 * tests/unit/stripe-account-deletion.test.ts
 * Etapa "5.7 — Account Deletion x Stripe" — `cancelAllStripeSubscriptionsForAccountDeletion`
 * (lib/stripe/subscription-management.ts), com Stripe E Supabase MOCKADOS.
 * Corrige SEC-01 (audit pós-Stripe 5.6): exclusão de conta não podia deixar
 * uma subscription Stripe `active` sobrevivendo à conta local.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

vi.mock('@/lib/stripe/subscription-sync', () => ({
  syncSubscriptionFromStripe: vi.fn().mockResolvedValue({ outcome: 'synced', subscriptionId: 'sub-uuid', previousStatus: 'active', newStatus: 'canceled', transitionRecorded: true }),
}))

const { cancelAllStripeSubscriptionsForAccountDeletion } = await import('@/lib/stripe/subscription-management')
const { syncSubscriptionFromStripe } = await import('@/lib/stripe/subscription-sync')

function makeMockSupabase(billingCustomerRow: { stripe_customer_id: string | null } | null, error: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: billingCustomerRow, error })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as unknown as SupabaseClient, from }
}

/** `stripe.subscriptions.list(...)` é async-iterável no SDK real (`for await...of`) — simula isso sem precisar de paginação de verdade. */
function makeSubscriptionsList(subscriptions: Partial<Stripe.Subscription>[]) {
  return vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      for (const s of subscriptions) yield s as Stripe.Subscription
    },
  })
}

describe('cancelAllStripeSubscriptionsForAccountDeletion', () => {
  it('usuário Free (sem billing_customer): nunca instancia o client Stripe, retorna vazio', async () => {
    const { client: supabase } = makeMockSupabase(null)
    const getStripe = vi.fn()

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, getStripe, 'user-free')

    expect(result).toEqual({ stripeCustomerId: null, canceledSubscriptionIds: [] })
    expect(getStripe).not.toHaveBeenCalled()
  })

  it('usuário courtesy-only (billing_customer existe mas sem stripe_customer_id): nunca instancia o Stripe', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: null })
    const getStripe = vi.fn()

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, getStripe, 'user-courtesy')

    expect(result).toEqual({ stripeCustomerId: null, canceledSubscriptionIds: [] })
    expect(getStripe).not.toHaveBeenCalled()
  })

  it('subscription ativa SEM schedule: cancela via subscriptions.cancel (nunca subscriptionSchedules.cancel)', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_1' })
    const list = makeSubscriptionsList([{ id: 'sub_1', status: 'active', schedule: null }])
    const cancel = vi.fn().mockResolvedValue({ id: 'sub_1', status: 'canceled' })
    const scheduleCancel = vi.fn()
    const stripe = { subscriptions: { list, cancel }, subscriptionSchedules: { cancel: scheduleCancel } } as unknown as Stripe

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-active')

    expect(cancel).toHaveBeenCalledWith('sub_1')
    expect(scheduleCancel).not.toHaveBeenCalled()
    expect(result).toEqual({ stripeCustomerId: 'cus_test_1', canceledSubscriptionIds: ['sub_1'] })
    expect(syncSubscriptionFromStripe).toHaveBeenCalledWith(supabase, stripe, 'sub_1', null)
  })

  it('subscription COM schedule ativo: cancela o schedule (nunca chama subscriptions.cancel diretamente)', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_2' })
    const list = makeSubscriptionsList([{ id: 'sub_2', status: 'active', schedule: 'sub_sched_1' }])
    const cancel = vi.fn()
    const scheduleCancel = vi.fn().mockResolvedValue({ id: 'sub_sched_1', status: 'canceled' })
    const stripe = { subscriptions: { list, cancel }, subscriptionSchedules: { cancel: scheduleCancel } } as unknown as Stripe

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-scheduled')

    expect(scheduleCancel).toHaveBeenCalledWith('sub_sched_1')
    expect(cancel).not.toHaveBeenCalled()
    expect(result.canceledSubscriptionIds).toEqual(['sub_2'])
  })

  it('schedule vem como objeto expandido (não string): resolve o id corretamente', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_3' })
    const list = makeSubscriptionsList([{ id: 'sub_3', status: 'active', schedule: { id: 'sub_sched_2' } as Stripe.SubscriptionSchedule }])
    const scheduleCancel = vi.fn().mockResolvedValue({ id: 'sub_sched_2' })
    const stripe = { subscriptions: { list, cancel: vi.fn() }, subscriptionSchedules: { cancel: scheduleCancel } } as unknown as Stripe

    await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-expanded-schedule')

    expect(scheduleCancel).toHaveBeenCalledWith('sub_sched_2')
  })

  it('subscription já "canceled": nunca chama nenhuma API de cancelamento', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_4' })
    const list = makeSubscriptionsList([{ id: 'sub_4', status: 'canceled', schedule: null }])
    const cancel = vi.fn()
    const scheduleCancel = vi.fn()
    const stripe = { subscriptions: { list, cancel }, subscriptionSchedules: { cancel: scheduleCancel } } as unknown as Stripe

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-already-canceled')

    expect(cancel).not.toHaveBeenCalled()
    expect(scheduleCancel).not.toHaveBeenCalled()
    expect(result.canceledSubscriptionIds).toEqual([])
  })

  it('subscription "incomplete_expired": estado terminal, nenhuma ação', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_5' })
    const list = makeSubscriptionsList([{ id: 'sub_5', status: 'incomplete_expired', schedule: null }])
    const cancel = vi.fn()
    const stripe = { subscriptions: { list, cancel }, subscriptionSchedules: { cancel: vi.fn() } } as unknown as Stripe

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-incomplete-expired')

    expect(cancel).not.toHaveBeenCalled()
    expect(result.canceledSubscriptionIds).toEqual([])
  })

  it('múltiplas subscriptions históricas: só a NÃO-terminal é cancelada', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_6' })
    const list = makeSubscriptionsList([
      { id: 'sub_old_canceled', status: 'canceled', schedule: null },
      { id: 'sub_live', status: 'past_due', schedule: null },
    ])
    const cancel = vi.fn().mockResolvedValue({ id: 'sub_live', status: 'canceled' })
    const stripe = { subscriptions: { list, cancel }, subscriptionSchedules: { cancel: vi.fn() } } as unknown as Stripe

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-multi')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('sub_live')
    expect(result.canceledSubscriptionIds).toEqual(['sub_live'])
  })

  it('cancel_at_period_end=true não é usado — subscription ativa é cancelada IMEDIATAMENTE via subscriptions.cancel', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_7' })
    const list = makeSubscriptionsList([{ id: 'sub_7', status: 'active', cancel_at_period_end: true, schedule: null }])
    const cancel = vi.fn().mockResolvedValue({ id: 'sub_7', status: 'canceled' })
    const update = vi.fn()
    const stripe = { subscriptions: { list, cancel, update }, subscriptionSchedules: { cancel: vi.fn() } } as unknown as Stripe

    await cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-cape-true')

    expect(cancel).toHaveBeenCalledWith('sub_7')
    expect(update).not.toHaveBeenCalled() // nunca usa subscriptions.update({cancel_at_period_end:true}) aqui
  })

  it('falha ao consultar billing_customers: propaga o erro (nunca mascara)', async () => {
    const { client: supabase } = makeMockSupabase(null, { message: 'conexão perdida (simulado)' })
    await expect(cancelAllStripeSubscriptionsForAccountDeletion(supabase, vi.fn(), 'user-db-error')).rejects.toThrow(/conexão perdida/)
  })

  it('falha do Stripe ao cancelar: propaga o erro (nunca engole, quem decide abortar é o chamador)', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_8' })
    const list = makeSubscriptionsList([{ id: 'sub_8', status: 'active', schedule: null }])
    const cancel = vi.fn().mockRejectedValue(new Error('Stripe indisponível (simulado)'))
    const stripe = { subscriptions: { list, cancel }, subscriptionSchedules: { cancel: vi.fn() } } as unknown as Stripe

    await expect(cancelAllStripeSubscriptionsForAccountDeletion(supabase, () => stripe, 'user-stripe-fails')).rejects.toThrow(/Stripe indisponível/)
  })

  it('falha ao instanciar o client Stripe: propaga sem tentar nenhuma chamada de cancelamento', async () => {
    const { client: supabase } = makeMockSupabase({ stripe_customer_id: 'cus_test_9' })
    const getStripe = vi.fn(() => {
      throw new Error('STRIPE_SECRET_KEY ausente (simulado)')
    })

    await expect(cancelAllStripeSubscriptionsForAccountDeletion(supabase, getStripe, 'user-no-stripe-client')).rejects.toThrow(/STRIPE_SECRET_KEY/)
  })

  it('nunca aceita stripeCustomerId/subscriptionId de fora — a assinatura da função só recebe userId', () => {
    expect(cancelAllStripeSubscriptionsForAccountDeletion.length).toBe(3)
  })
})
