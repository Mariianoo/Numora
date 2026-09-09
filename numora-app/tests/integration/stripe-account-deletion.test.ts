/**
 * tests/integration/stripe-account-deletion.test.ts
 * Etapa "5.7 — Account Deletion x Stripe" — prova, contra Supabase DEV real
 * E Stripe TEST MODE real, que a exclusão de conta nunca deixa uma
 * subscription Stripe ativa sobrevivendo (SEC-01, audit pós-Stripe 5.6).
 *
 * Reproduz a MESMA sequência ordenada de `app/api/account/delete/route.ts`
 * (não importa o Route Handler diretamente — precisaria de sessão HTTP real
 * via servidor Next rodando; mesmo padrão já usado em
 * `tests/integration/account-deletion.test.ts`): resolver stripe client →
 * cancelAllStripeSubscriptionsForAccountDeletion → ban → (Storage omitido,
 * nenhum destes testes sobe foto) → delete_own_account_data → deleteUser.
 *
 * ZERO Product/Price oficial é tocado. Todo Customer/Subscription/Schedule
 * criado aqui é de teste, limpo em `afterAll` (best-effort — a maioria já
 * fica `canceled` pelo próprio teste).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { cancelAllStripeSubscriptionsForAccountDeletion, changeOwnPlan } from '@/lib/stripe/subscription-management'
import { syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'
import { createAdminClient, createDisposableUser, getTestEnv, hasTestEnv, type TestEnv } from '../support/dev-env'

const BAN_DURATION = '876000h'

describe.skipIf(!hasTestEnv())('Account deletion × Stripe (DEV real + Stripe TEST real) — Etapa 5.7', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  let proMonthBrlPriceId: string
  let premiumMonthBrlPriceId: string
  const createdStripeCustomerIds = new Set<string>()

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()

    const { data } = await admin.from('plan_prices').select('stripe_price_id, plans:plan_id(slug)').eq('interval', 'month').eq('currency', 'BRL').eq('active', true)
    for (const row of data ?? []) {
      const slug = Array.isArray(row.plans) ? row.plans[0]?.slug : (row.plans as { slug: string } | null)?.slug
      if (slug === 'pro') proMonthBrlPriceId = row.stripe_price_id as string
      if (slug === 'premium') premiumMonthBrlPriceId = row.stripe_price_id as string
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

  /** Reproduz a sequência real de exclusão a partir do ponto em que a rota já resolveu `userId`/`adminClient`/`stripe`. */
  async function runAccountDeletionSequence(userId: string): Promise<void> {
    await cancelAllStripeSubscriptionsForAccountDeletion(admin, () => stripe, userId)
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION })
    if (banError) throw banError
    const { error: rpcError } = await admin.rpc('delete_own_account_data', { p_user_id: userId })
    if (rpcError) throw rpcError
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
    if (deleteUserError && deleteUserError.status !== 404) throw deleteUserError
  }

  async function setupUserWithRealSubscription(label: string, priceId: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: billingCustomer.stripeCustomerId })
    await stripe.customers.update(billingCustomer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: priceId }] })

    await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_setup')

    return { user, stripeCustomerId: billingCustomer.stripeCustomerId, subscription }
  }

  it('1. usuário Free: exclusão funciona normalmente, nenhuma chamada Stripe necessária', async () => {
    const user = await createDisposableUser(admin, 'deletion-free')
    await expect(runAccountDeletionSequence(user.id)).resolves.toBeUndefined()

    const { data } = await admin.auth.admin.getUserById(user.id)
    expect(data.user).toBeNull()
  })

  it('2. usuário pago ATIVO: subscription Stripe é cancelada ANTES da exclusão local completar', async () => {
    const { user, stripeCustomerId, subscription } = await setupUserWithRealSubscription('deletion-active', proMonthBrlPriceId)

    await runAccountDeletionSequence(user.id)

    const stripeSub = await stripe.subscriptions.retrieve(subscription.id)
    expect(stripeSub.status).toBe('canceled')

    const { data: authUser } = await admin.auth.admin.getUserById(user.id)
    expect(authUser.user).toBeNull()

    // Customer preservado (histórico/auditoria) — nunca deletado.
    const customer = await stripe.customers.retrieve(stripeCustomerId)
    expect(customer.deleted).not.toBe(true)
  })

  it('3. cancel_at_period_end já true: mesmo assim é cancelada IMEDIATAMENTE (nunca fica "pendente")', async () => {
    const { user, subscription } = await setupUserWithRealSubscription('deletion-cape', proMonthBrlPriceId)
    await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })

    await runAccountDeletionSequence(user.id)

    const stripeSub = await stripe.subscriptions.retrieve(subscription.id)
    expect(stripeSub.status).toBe('canceled') // não ficou só "vai cancelar no fim do período"
  })

  it('4. subscription já canceled: exclusão sucede sem erro (idempotente, nenhuma chamada desnecessária)', async () => {
    const { user, subscription } = await setupUserWithRealSubscription('deletion-already-canceled', proMonthBrlPriceId)
    await stripe.subscriptions.cancel(subscription.id)

    await expect(runAccountDeletionSequence(user.id)).resolves.toBeUndefined()
  })

  it('5. múltiplas subscriptions históricas: só a viva é cancelada, a histórica permanece intocada', async () => {
    const user = await createDisposableUser(admin, 'deletion-multi')
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: billingCustomer.stripeCustomerId })
    await stripe.customers.update(billingCustomer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })

    const oldSub = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: proMonthBrlPriceId }] })
    await stripe.subscriptions.cancel(oldSub.id)

    const liveSub = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: proMonthBrlPriceId }] })
    await syncSubscriptionFromStripe(admin, stripe, liveSub.id, 'evt_test_setup_2')

    await runAccountDeletionSequence(user.id)

    const liveAfter = await stripe.subscriptions.retrieve(liveSub.id)
    expect(liveAfter.status).toBe('canceled')
    const oldAfter = await stripe.subscriptions.retrieve(oldSub.id)
    expect(oldAfter.status).toBe('canceled') // já estava, continua — nunca tocada de novo
  }, 30_000)

  it('6. subscription com Subscription Schedule ativo: schedule é cancelado e a subscription fica canceled junto', async () => {
    const { user, subscription } = await setupUserWithRealSubscription('deletion-scheduled', premiumMonthBrlPriceId)

    // Agenda um downgrade real (mesmo mecanismo da Stripe 5.6) para deixar um Schedule ativo.
    const result = await changeOwnPlan(admin, stripe, user.id, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
    expect(result.kind).toBe('downgrade_scheduled')
    const scheduleId = result.kind === 'downgrade_scheduled' ? result.stripeScheduleId : null
    expect(scheduleId).toBeTruthy()

    await runAccountDeletionSequence(user.id)

    const scheduleAfter = await stripe.subscriptionSchedules.retrieve(scheduleId!)
    expect(scheduleAfter.status).toBe('canceled')
    const subAfter = await stripe.subscriptions.retrieve(subscription.id)
    expect(subAfter.status).toBe('canceled')
  }, 30_000)

  it('7. falha do Stripe ao cancelar: exclusão NÃO completa — profile/billing_customer/subscription continuam intactos', async () => {
    const { user } = await setupUserWithRealSubscription('deletion-stripe-fails', proMonthBrlPriceId)

    const brokenStripe = {
      subscriptions: {
        list: () => ({
          [Symbol.asyncIterator]: async function* () {
            yield { id: 'sub_fake', status: 'active', schedule: null } as unknown as Stripe.Subscription
          },
        }),
        cancel: async () => {
          throw new Error('Stripe indisponível (simulado)')
        },
      },
      subscriptionSchedules: { cancel: async () => undefined },
    } as unknown as Stripe

    await expect(cancelAllStripeSubscriptionsForAccountDeletion(admin, () => brokenStripe, user.id)).rejects.toThrow(/Stripe indisponível/)

    // Nada local foi tocado: nem ban, nem RPC, nem deleteUser rodaram.
    const { data: authUser } = await admin.auth.admin.getUserById(user.id)
    expect(authUser.user).not.toBeNull()
    expect(authUser.user?.banned_until ?? null).toBeFalsy()

    const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle()
    expect(profile?.id).toBe(user.id)

    const { data: billingCustomer } = await admin.from('billing_customers').select('id').eq('user_id', user.id).maybeSingle()
    expect(billingCustomer).not.toBeNull()

    // Cleanup manual (a subscription real do Stripe ainda está ativa de verdade).
    await runAccountDeletionSequence(user.id)
  })

  it('8. usuário A não afeta usuário B — cada exclusão só cancela o próprio Customer', async () => {
    const a = await setupUserWithRealSubscription('deletion-isolation-a', proMonthBrlPriceId)
    const b = await setupUserWithRealSubscription('deletion-isolation-b', proMonthBrlPriceId)

    await runAccountDeletionSequence(a.user.id)

    const subB = await stripe.subscriptions.retrieve(b.subscription.id)
    expect(subB.status).toBe('active') // B nunca foi tocado

    await runAccountDeletionSequence(b.user.id)
  })

  it('9. usuário courtesy-only (benefit_grants, sem billing_customer): exclusão sucede sem nenhuma chamada Stripe', async () => {
    const user = await createDisposableUser(admin, 'deletion-courtesy')

    const { error: grantError } = await admin.from('benefit_grants').insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste', created_by: user.id })
    if (grantError) throw new Error(`setup de benefit_grant falhou: ${grantError.message}`)

    const result = await cancelAllStripeSubscriptionsForAccountDeletion(admin, () => stripe, user.id)
    expect(result).toEqual({ stripeCustomerId: null, canceledSubscriptionIds: [] })

    await runAccountDeletionSequence(user.id)
  })
})
