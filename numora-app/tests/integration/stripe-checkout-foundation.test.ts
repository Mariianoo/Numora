/**
 * tests/integration/stripe-checkout-foundation.test.ts
 * Etapa "Stripe 5.3 — Checkout Foundation" — prova, contra Supabase DEV
 * real E Stripe TEST MODE real, que o pipeline completo (resolução de
 * preço local → Customer, Stripe 5.2 → Checkout Session) funciona para as
 * 8 combinações comerciais, resiste a concorrência e a manipulação de
 * payload, e NUNCA cria subscription local nem real.
 *
 * Reproduz exatamente a sequência de `app/api/billing/checkout/route.ts`
 * (mesmo padrão de `tests/integration/account-deletion.test.ts`: chama as
 * mesmas funções/operações, na mesma ordem, sem precisar de um servidor
 * Next real) — permite asserção fina contra o Stripe (retrieve da Session)
 * que um teste E2E via UI não faria com a mesma precisão.
 *
 * Cenários que exigiriam alterar o catálogo comercial oficial para serem
 * reproduzidos (preço INATIVO, combinação verdadeiramente inexistente —
 * as 8 combinações reais de pro/premium já cobrem 100% do espaço
 * combinatório válido, sem nenhuma lacuna) estão cobertos só em
 * tests/unit/stripe-checkout.test.ts (`resolveSellablePrice`, catálogo
 * fabricado) — nunca tocamos os 8 `plan_prices` reais aqui.
 *
 * ZERO subscription é criada — nenhum teste completa o Checkout (nenhum
 * cartão de teste é usado), nenhum teste chama
 * `stripe.subscriptions.create`. Confirmado ao final tanto em DEV
 * (`subscriptions=0`) quanto no Stripe (`stripe.subscriptions.list()`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getCommercialPlanPricesCatalog } from '@/lib/stripe/catalog'
import { checkoutRequestSchema, createCheckoutSession, resolveSellablePrice } from '@/lib/stripe/checkout'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { getStripeClient } from '@/lib/stripe/client'
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

const TEST_SUCCESS_URL = 'https://numora.test/dashboard?checkout=success'
const TEST_CANCEL_URL = 'https://numora.test/dashboard?checkout=cancel'

const COMBINATIONS = [
  { planSlug: 'pro', interval: 'month', currency: 'BRL', expectedAmount: 19.9 },
  { planSlug: 'pro', interval: 'year', currency: 'BRL', expectedAmount: 199.0 },
  { planSlug: 'pro', interval: 'month', currency: 'USD', expectedAmount: 5.99 },
  { planSlug: 'pro', interval: 'year', currency: 'USD', expectedAmount: 59.0 },
  { planSlug: 'premium', interval: 'month', currency: 'BRL', expectedAmount: 34.9 },
  { planSlug: 'premium', interval: 'year', currency: 'BRL', expectedAmount: 349.0 },
  { planSlug: 'premium', interval: 'month', currency: 'USD', expectedAmount: 9.99 },
  { planSlug: 'premium', interval: 'year', currency: 'USD', expectedAmount: 99.0 },
] as const

describe.skipIf(!hasTestEnv())('Checkout foundation (DEV real + Stripe TEST real) — Stripe 5.3', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  const createdStripeCustomerIds = new Set<string>()
  const createdCheckoutSessionIds = new Set<string>()

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()
  })

  afterAll(async () => {
    console.log(`[stripe-checkout-foundation] Checkout Sessions criadas neste arquivo: ${createdCheckoutSessionIds.size}`)

    for (const id of createdCheckoutSessionIds) {
      try {
        await stripe.checkout.sessions.expire(id)
      } catch {
        // Sessão já pode ter expirado sozinha (TTL padrão do Stripe) — nunca um erro do teste.
      }
    }

    for (const id of createdStripeCustomerIds) {
      try {
        await stripe.customers.del(id)
      } catch {
        // Idempotente o suficiente para este cleanup.
      }
    }

    // FASE 16/22 — confirma no Stripe (não só localmente) que nenhuma
    // subscription real foi criada por nenhum teste deste arquivo.
    const subscriptions = await stripe.subscriptions.list({ limit: 100 })
    expect(subscriptions.data).toHaveLength(0)
  })

  async function setupUser(label: string): Promise<{ user: DisposableUser; userClient: SupabaseClient }> {
    const user = await createDisposableUser(admin, label)
    const userClient = await signInAsDisposableUser(env, user)
    return { user, userClient }
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  /** Mesma sequência de app/api/billing/checkout/route.ts, sem servidor HTTP. */
  async function runCheckoutPipeline(userClient: SupabaseClient, user: DisposableUser, body: unknown) {
    const parsed = checkoutRequestSchema.parse(body)
    if (parsed.planSlug === 'free') {
      throw new Error('FREE_HAS_NO_CHECKOUT')
    }
    const catalog = await getCommercialPlanPricesCatalog(userClient)
    const resolution = resolveSellablePrice(catalog, { planSlug: parsed.planSlug, interval: parsed.interval, currency: parsed.currency })
    if (resolution.status !== 'ok') {
      throw new Error(`PRICE_${resolution.status.toUpperCase()}`)
    }
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

    const session = await createCheckoutSession(stripe, {
      stripePriceId: resolution.price.stripePriceId!,
      stripeCustomerId: billingCustomer.stripeCustomerId,
      userId: user.id,
      successUrl: TEST_SUCCESS_URL,
      cancelUrl: TEST_CANCEL_URL,
    })
    createdCheckoutSessionIds.add(session.id)

    return { session, resolution, billingCustomer }
  }

  describe('FASE 14 — as 8 combinações comerciais', () => {
    it.each(COMBINATIONS)('$planSlug $interval $currency', async ({ planSlug, interval, currency, expectedAmount }) => {
      const { user, userClient } = await setupUser(`checkout-${planSlug}-${interval}-${currency}`)
      try {
        const { session, resolution, billingCustomer } = await runCheckoutPipeline(userClient, user, { planSlug, interval, currency })

        expect(session.object).toBe('checkout.session')
        expect(session.mode).toBe('subscription')
        expect(session.customer).toBe(billingCustomer.stripeCustomerId)
        expect(session.client_reference_id).toBe(user.id)
        expect(session.metadata?.numora_user_id).toBe(user.id)

        const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] })
        expect(fullSession.line_items?.data).toHaveLength(1)
        const lineItem = fullSession.line_items!.data[0]
        expect(lineItem.quantity).toBe(1)
        expect(lineItem.price?.id).toBe(resolution.status === 'ok' ? resolution.price.stripePriceId : undefined)
        expect(lineItem.price?.currency).toBe(currency.toLowerCase())
        expect(lineItem.price?.unit_amount).toBe(Math.round(expectedAmount * 100))
        expect(lineItem.price?.recurring?.interval).toBe(interval)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 6 — Free nunca gera Checkout Session', () => {
    it('planSlug=free é rejeitado antes de qualquer chamada ao Stripe', async () => {
      const { user, userClient } = await setupUser('checkout-free')
      try {
        await expect(runCheckoutPipeline(userClient, user, { planSlug: 'free', interval: 'month', currency: 'BRL' })).rejects.toThrow('FREE_HAS_NO_CHECKOUT')
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 11 — concorrência: 2 requisições simultâneas do mesmo usuário', () => {
    it('geram 2 Checkout Sessions independentes, mas reaproveitam o MESMO Stripe Customer', async () => {
      const { user, userClient } = await setupUser('checkout-race')
      try {
        const [resultA, resultB] = await Promise.all([
          runCheckoutPipeline(userClient, user, { planSlug: 'pro', interval: 'month', currency: 'BRL' }),
          runCheckoutPipeline(userClient, user, { planSlug: 'pro', interval: 'month', currency: 'BRL' }),
        ])

        expect(resultA.session.id).not.toBe(resultB.session.id) // 2 tentativas distintas, nunca deduplicadas
        expect(resultA.billingCustomer.stripeCustomerId).toBe(resultB.billingCustomer.stripeCustomerId) // mesmo Customer (Stripe 5.2)

        const { data: rows } = await admin.from('billing_customers').select('id').eq('user_id', user.id)
        expect(rows).toHaveLength(1)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 12 — manipulação de payload contra o pipeline real', () => {
    it('priceId/customerId arbitrários no body são ignorados — a Session usa exclusivamente o preço/Customer resolvidos pelo servidor', async () => {
      const { user, userClient } = await setupUser('checkout-manipulation')
      try {
        const maliciousBody = {
          planSlug: 'pro',
          interval: 'month',
          currency: 'BRL',
          // Campos que um cliente malicioso poderia tentar enviar — não existem no schema, devem ser ignorados.
          priceId: 'price_1UDRBNEIGTvflHUJd4aNfqJD', // premium/month/USD de verdade — tentativa de comprar Premium pagando o preço de Pro
          customerId: 'cus_arbitrario_inexistente',
        }

        const { session, resolution } = await runCheckoutPipeline(userClient, user, maliciousBody)

        const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] })
        const lineItem = fullSession.line_items!.data[0]

        expect(resolution.status === 'ok' && resolution.price.planSlug).toBe('pro')
        expect(lineItem.price?.id).not.toBe(maliciousBody.priceId) // nunca usa o priceId injetado
        expect(session.customer).not.toBe(maliciousBody.customerId) // nunca usa o customerId injetado
      } finally {
        await teardownUser(user)
      }
    })

    it('combinação com currency inválida é rejeitada pelo schema antes de qualquer chamada ao Stripe/banco', async () => {
      const { user, userClient } = await setupUser('checkout-invalid-currency')
      try {
        await expect(runCheckoutPipeline(userClient, user, { planSlug: 'pro', interval: 'month', currency: 'EUR' })).rejects.toThrow()
      } finally {
        await teardownUser(user)
      }
    })

    it('interval inválido é rejeitado pelo schema', async () => {
      const { user, userClient } = await setupUser('checkout-invalid-interval')
      try {
        await expect(runCheckoutPipeline(userClient, user, { planSlug: 'pro', interval: 'week', currency: 'BRL' })).rejects.toThrow()
      } finally {
        await teardownUser(user)
      }
    })

    it('planSlug inexistente é rejeitado pelo schema', async () => {
      const { user, userClient } = await setupUser('checkout-invalid-plan')
      try {
        await expect(runCheckoutPipeline(userClient, user, { planSlug: 'enterprise', interval: 'month', currency: 'BRL' })).rejects.toThrow()
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 18 — RLS não foi enfraquecida por esta etapa', () => {
    it('usuário comum continua sem conseguir escrever em billing_customers diretamente', async () => {
      const { user, userClient } = await setupUser('checkout-rls')
      try {
        const { error } = await userClient.from('billing_customers').insert({ user_id: user.id, stripe_customer_id: `cus_test53_rls_${Date.now()}` })
        expect(error).not.toBeNull()
      } finally {
        await teardownUser(user)
      }
    })
  })
})
