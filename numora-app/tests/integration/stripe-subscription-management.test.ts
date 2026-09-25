/**
 * tests/integration/stripe-subscription-management.test.ts
 * Etapa "Stripe 5.6 — Customer Portal / Gestão da Assinatura" — prova,
 * contra Supabase DEV real E Stripe TEST MODE real:
 *   - Customer Portal Session real (usando a Configuration criada nesta etapa);
 *   - cancelamento real (`cancel_at_period_end`, nunca imediato);
 *   - upgrade Pro→Premium BLOQUEADO (Premium "Em breve" — Bloco A, sem chamada ao Stripe);
 *   - downgrade real Premium→Pro (Subscription Schedule real, 2 fases);
 *   - `get_my_subscription()` (RPC self-scoped) refletindo cada estado.
 *
 * ZERO Product/Price oficial é tocado. Toda subscription/Customer/Schedule
 * criado aqui é de teste, limpo em `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { createBillingPortalSession } from '@/lib/stripe/portal'
import { cancelOwnSubscription, changeOwnPlan } from '@/lib/stripe/subscription-management'
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

describe.skipIf(!hasTestEnv())('Customer Portal / gestão da assinatura (DEV real + Stripe TEST real) — Stripe 5.6', () => {
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

    const { data } = await admin.from('plan_prices').select('stripe_price_id, plans:plan_id(slug)').eq('interval', 'month').eq('currency', 'BRL').eq('active', true)
    for (const row of data ?? []) {
      const slug = Array.isArray(row.plans) ? row.plans[0]?.slug : (row.plans as { slug: string } | null)?.slug
      if (slug === 'pro') proMonthBrlPriceId = row.stripe_price_id as string
      if (slug === 'premium') premiumMonthBrlPriceId = row.stripe_price_id as string
    }
  })

  afterAll(async () => {
    await Promise.allSettled(Array.from(createdStripeSubscriptionIds).map((id) => stripe.subscriptions.cancel(id).catch(() => undefined)))
    await Promise.allSettled(Array.from(createdStripeCustomerIds).map((id) => stripe.customers.del(id).catch(() => undefined)))
  }, 60_000)

  async function setupUserWithRealSubscription(label: string, priceId: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: billingCustomer.stripeCustomerId })
    await stripe.customers.update(billingCustomer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: priceId }] })
    createdStripeSubscriptionIds.add(subscription.id)

    await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_setup')

    return { user, stripeCustomerId: billingCustomer.stripeCustomerId, subscription }
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('subscriptions').delete().eq('user_id', user.id)
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  describe('Customer Portal', () => {
    it('cria uma sessão real usando a Configuration padrão da conta', async () => {
      const user = await createDisposableUser(admin, 'portal-session')
      try {
        const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
        createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

        const session = await createBillingPortalSession(stripe, { stripeCustomerId: billingCustomer.stripeCustomerId, returnUrl: 'https://numora.test/dashboard/profile' })

        expect(session.object).toBe('billing_portal.session')
        expect(session.customer).toBe(billingCustomer.stripeCustomerId)
        expect(session.return_url).toBe('https://numora.test/dashboard/profile')
        expect(session.url).toMatch(/^https:\/\/billing\.stripe\.com\//)
      } finally {
        await teardownUser(user)
      }
    })

    it('Customer inexistente localmente: getOrCreateBillingCustomer cria um novo (nunca abre o Portal de outro usuário)', async () => {
      const userA = await createDisposableUser(admin, 'portal-isolation-a')
      const userB = await createDisposableUser(admin, 'portal-isolation-b')
      try {
        const customerA = await getOrCreateBillingCustomer(admin, stripe, { userId: userA.id, email: userA.email })
        const customerB = await getOrCreateBillingCustomer(admin, stripe, { userId: userB.id, email: userB.email })
        createdStripeCustomerIds.add(customerA.stripeCustomerId)
        createdStripeCustomerIds.add(customerB.stripeCustomerId)

        expect(customerA.stripeCustomerId).not.toBe(customerB.stripeCustomerId)
      } finally {
        await teardownUser(userA)
        await teardownUser(userB)
      }
    })
  })

  describe('Cancelamento', () => {
    it('cancel_at_period_end=true, status permanece active, effective_plan mantém o plano até o fim do período', async () => {
      const { user, subscription } = await setupUserWithRealSubscription('cancel-flow', proMonthBrlPriceId)
      try {
        const updated = await cancelOwnSubscription(admin, stripe, user.id)
        expect(updated.cancel_at_period_end).toBe(true)
        expect(updated.status).toBe('active')

        await syncSubscriptionFromStripe(admin, stripe, subscription.id, null)

        const { data: row } = await admin.from('subscriptions').select('status, cancel_at_period_end').eq('stripe_subscription_id', subscription.id).single()
        expect(row?.status).toBe('active')
        expect(row?.cancel_at_period_end).toBe(true)

        const { data: effective } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effective?.[0]?.plan_slug).toBe('pro') // acesso mantido
      } finally {
        await teardownUser(user)
      }
    })

    it('usuário sem subscription elegível não consegue cancelar nada (nunca aceita subscriptionId de fora)', async () => {
      const user = await createDisposableUser(admin, 'cancel-no-subscription')
      try {
        await expect(cancelOwnSubscription(admin, stripe, user.id)).rejects.toThrow(/Nenhuma subscription elegível/)
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })

    it('usuário A não consegue afetar a subscription do usuário B', async () => {
      const a = await setupUserWithRealSubscription('cancel-isolation-a', proMonthBrlPriceId)
      const b = await setupUserWithRealSubscription('cancel-isolation-b', proMonthBrlPriceId)
      try {
        await cancelOwnSubscription(admin, stripe, a.user.id)

        const stripeSubB = await stripe.subscriptions.retrieve(b.subscription.id)
        expect(stripeSubB.cancel_at_period_end).toBe(false) // B nunca foi afetado
      } finally {
        await teardownUser(a.user)
        await teardownUser(b.user)
      }
    })
  })

  // Bloco A (Official Launch Foundation) — Premium é "Em breve" (D1/D2): o
  // upgrade Pro→Premium NÃO é mais contratável, independente de o preço do
  // Premium estar ativo no catálogo real. A guarda (lib/billing/plan-availability.ts)
  // roda ANTES de qualquer leitura de subscription ou chamada ao Stripe, então
  // este teste não cria nenhuma subscription/Customer no Stripe — só prova a
  // rejeição. (A mecânica dormante de upgrade segue coberta, com a
  // disponibilidade simulada, em tests/unit/stripe-subscription-management.test.ts.)
  describe('Upgrade Pro → Premium (bloqueado — Premium "Em breve")', () => {
    it('é rejeitado pela guarda de disponibilidade antes de qualquer acesso a subscription/Stripe', async () => {
      const user = await createDisposableUser(admin, 'upgrade-premium-blocked')
      try {
        await expect(changeOwnPlan(admin, stripe, user.id, { planSlug: 'premium', interval: 'month', currency: 'BRL' })).rejects.toThrow(/não está disponível para contratação/)
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })
  })

  describe('Downgrade Premium → Pro (Subscription Schedule real)', () => {
    it('cria um Schedule real com 2 fases; Premium permanece ativo até current_period_end; plan_id local só muda quando a fase virar', async () => {
      const { user, subscription } = await setupUserWithRealSubscription('downgrade-flow', premiumMonthBrlPriceId)
      try {
        const result = await changeOwnPlan(admin, stripe, user.id, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
        expect(result.kind).toBe('downgrade_scheduled')

        const stripeSub = await stripe.subscriptions.retrieve(subscription.id)
        const currentPriceId = typeof stripeSub.items.data[0].price === 'string' ? stripeSub.items.data[0].price : stripeSub.items.data[0].price.id
        expect(currentPriceId).toBe(premiumMonthBrlPriceId) // NUNCA muda imediatamente
        expect(typeof stripeSub.schedule === 'string' ? stripeSub.schedule : stripeSub.schedule?.id).toBeTruthy()

        await syncSubscriptionFromStripe(admin, stripe, subscription.id, null)
        const { data: row } = await admin
          .from('subscriptions')
          .select('stripe_price_id, scheduled_plan_id, stripe_schedule_id, plans:plan_id(slug), scheduled:scheduled_plan_id(slug)')
          .eq('stripe_subscription_id', subscription.id)
          .single()

        const currentSlug = Array.isArray(row?.plans) ? row?.plans[0]?.slug : ((row?.plans ?? null) as { slug: string } | null)?.slug
        const scheduledSlug = Array.isArray(row?.scheduled) ? row?.scheduled[0]?.slug : ((row?.scheduled ?? null) as { slug: string } | null)?.slug
        expect(currentSlug).toBe('premium') // effective_plan continua Premium até o fim do período
        expect(scheduledSlug).toBe('pro')
        expect(row?.stripe_schedule_id).toBeTruthy()

        const { data: effective } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effective?.[0]?.plan_slug).toBe('premium')

        // FASE 6 — retry: chamar de novo não cria um SEGUNDO schedule.
        if (result.kind === 'downgrade_scheduled') {
          const retryResult = await changeOwnPlan(admin, stripe, user.id, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
          expect(retryResult.kind).toBe('downgrade_scheduled')
          if (retryResult.kind === 'downgrade_scheduled') {
            expect(retryResult.stripeScheduleId).toBe(result.stripeScheduleId)
          }
        }

        const schedules = await stripe.subscriptionSchedules.list({ customer: (await stripe.subscriptions.retrieve(subscription.id)).customer as string })
        const schedulesForThisSub = schedules.data.filter((s) => (typeof s.subscription === 'string' ? s.subscription : s.subscription?.id) === subscription.id)
        expect(schedulesForThisSub).toHaveLength(1) // nunca duplicado
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('get_my_subscription()', () => {
    it('reflete a subscription elegível do próprio usuário (status, período, cancel_at_period_end)', async () => {
      const { user } = await setupUserWithRealSubscription('get-my-sub-active', proMonthBrlPriceId)
      try {
        const userClient = await signInAsDisposableUser(env, user)
        const { data, error } = await userClient.rpc('get_my_subscription')
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data![0].plan_slug).toBe('pro')
        expect(data![0].status).toBe('active')
        expect(data![0].cancel_at_period_end).toBe(false)
        expect(data![0].current_period_end).not.toBeNull()
        // Nunca expõe IDs internos do Stripe.
        expect(data![0]).not.toHaveProperty('stripe_subscription_id')
        expect(data![0]).not.toHaveProperty('stripe_customer_id')
      } finally {
        await teardownUser(user)
      }
    })

    it('usuário sem NENHUMA subscription: retorna vazio (Free)', async () => {
      const user = await createDisposableUser(admin, 'get-my-sub-none')
      try {
        const userClient = await signInAsDisposableUser(env, user)
        const { data, error } = await userClient.rpc('get_my_subscription')
        expect(error).toBeNull()
        expect(data).toEqual([])
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })

    it('usuário só vê a PRÓPRIA subscription — nunca a de outro usuário', async () => {
      const a = await setupUserWithRealSubscription('get-my-sub-isolation-a', proMonthBrlPriceId)
      const b = await setupUserWithRealSubscription('get-my-sub-isolation-b', premiumMonthBrlPriceId)
      try {
        const clientA = await signInAsDisposableUser(env, a.user)
        const { data } = await clientA.rpc('get_my_subscription')
        expect(data).toHaveLength(1)
        expect(data![0].plan_slug).toBe('pro') // nunca 'premium' (o plano de B)
      } finally {
        await teardownUser(a.user)
        await teardownUser(b.user)
      }
    })
  })

  describe('RLS não foi enfraquecida', () => {
    it('as novas colunas (scheduled_plan_id/stripe_schedule_id) continuam inacessíveis via leitura direta da tabela', async () => {
      const { user } = await setupUserWithRealSubscription('rls-new-columns', premiumMonthBrlPriceId)
      try {
        const userClient = await signInAsDisposableUser(env, user)
        const { data, error } = await userClient.from('subscriptions').select('id, scheduled_plan_id, stripe_schedule_id').eq('user_id', user.id)
        expect(error).toBeNull()
        expect(data).toEqual([]) // RLS continua sem nenhuma policy de SELECT para o dono
      } finally {
        await teardownUser(user)
      }
    })
  })
})
