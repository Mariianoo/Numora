/**
 * tests/unit/premium-purchase-guard.test.ts
 * Etapa "Official Launch Foundation — Bloco A" — prova a barreira de
 * DISPONIBILIDADE do plano no SERVIDOR (D1/D2: Premium é "Em breve", nunca
 * vendável só porque existe um preço no catálogo). Nenhum mock de
 * `lib/billing/plan-availability` aqui — é a regra real sob teste.
 *
 * Cobre as três camadas do servidor:
 *   1. `lib/billing/plan-availability.ts` (a regra pura);
 *   2. `POST /api/billing/checkout` e `POST /api/billing/subscription/change-plan`
 *      (Route Handlers chamados direto, com Stripe/Supabase/catálogo mockados);
 *   3. `changeOwnPlan` (defesa em profundidade para qualquer outro chamador).
 * Nenhum preço é ativado, nenhum Product/Price do Stripe é criado, nenhuma
 * chamada de rede é feita.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import type { CommercialPlanPrice } from '@/lib/stripe/catalog'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser: (...args: unknown[]) => getUser(...args) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdminClient: () => ({}) }))
vi.mock('@/lib/billing/assert-billing-environment', () => ({
  assertBillingEnvironment: vi.fn(),
  gatherBillingEnvironmentContext: vi.fn(() => ({})),
}))
vi.mock('@/lib/env.server', () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: 'https://numora.test' } }))

const getStripeClient = vi.fn(() => ({}) as unknown as Stripe)
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: () => getStripeClient() }))

const getCommercialPlanPricesCatalog = vi.fn<() => Promise<CommercialPlanPrice[]>>()
vi.mock('@/lib/stripe/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/catalog')>()
  return { ...actual, getCommercialPlanPricesCatalog: (...args: unknown[]) => getCommercialPlanPricesCatalog(...(args as [])) }
})

const getOrCreateBillingCustomer = vi.fn()
vi.mock('@/lib/stripe/customer', () => ({ getOrCreateBillingCustomer: (...args: unknown[]) => getOrCreateBillingCustomer(...args) }))

const createCheckoutSession = vi.fn()
vi.mock('@/lib/stripe/checkout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/checkout')>()
  return { ...actual, createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args) }
})

const syncSubscriptionFromStripe = vi.fn()
vi.mock('@/lib/stripe/subscription-sync', () => ({ syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripe(...args) }))

const changeOwnPlanMock = vi.fn()
vi.mock('@/lib/stripe/subscription-management', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/subscription-management')>()
  return { ...actual, changeOwnPlan: (...args: unknown[]) => changeOwnPlanMock(...args) }
})

const { PLAN_UNAVAILABLE_MESSAGE, PURCHASABLE_PLAN_SLUGS, COMING_SOON_PLAN_SLUGS, isPlanComingSoon, isPlanPurchasable } = await import('@/lib/billing/plan-availability')
const { POST: checkoutPOST } = await import('@/app/api/billing/checkout/route')
const { POST: changePlanPOST } = await import('@/app/api/billing/subscription/change-plan/route')
const { changeOwnPlan: realChangeOwnPlan } = await vi.importActual<typeof import('@/lib/stripe/subscription-management')>('@/lib/stripe/subscription-management')

const PRO_MONTH_BRL: CommercialPlanPrice = { planPriceId: 'pp-pro-month-brl', planId: 'plan-pro', planSlug: 'pro', interval: 'month', currency: 'BRL', amount: 19.9, stripePriceId: 'price_pro_month_brl', active: true }
/** Premium com preço ATIVO e stripe_price_id — a guarda nunca pode depender disso. */
const PREMIUM_MONTH_BRL_ACTIVE: CommercialPlanPrice = { planPriceId: 'pp-premium-month-brl', planId: 'plan-premium', planSlug: 'premium', interval: 'month', currency: 'BRL', amount: 34.9, stripePriceId: 'price_premium_month_brl', active: true }

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

beforeEach(() => {
  captureException.mockReset()
  getUser.mockReset()
  getStripeClient.mockClear()
  getCommercialPlanPricesCatalog.mockReset()
  getOrCreateBillingCustomer.mockReset()
  createCheckoutSession.mockReset()
  syncSubscriptionFromStripe.mockReset()
  changeOwnPlanMock.mockReset()

  getUser.mockResolvedValue({ data: { user: { id: 'user-uuid-1', email: 'colecionador@example.test' } }, error: null })
})

describe('lib/billing/plan-availability — regra pura', () => {
  it('só o Pro é contratável hoje', () => {
    expect(isPlanPurchasable('pro')).toBe(true)
    expect([...PURCHASABLE_PLAN_SLUGS]).toEqual(['pro'])
  })

  it('Premium NÃO é contratável e está marcado como "em breve"', () => {
    expect(isPlanPurchasable('premium')).toBe(false)
    expect(isPlanComingSoon('premium')).toBe(true)
    expect([...COMING_SOON_PLAN_SLUGS]).toEqual(['premium'])
  })

  it('Free (sem Checkout) e qualquer slug desconhecido/vazio são NÃO contratáveis — fail-closed', () => {
    expect(isPlanPurchasable('free')).toBe(false)
    expect(isPlanPurchasable('enterprise')).toBe(false)
    expect(isPlanPurchasable('')).toBe(false)
    expect(isPlanPurchasable('PRO')).toBe(false) // nunca compara sem normalização
  })

  it('nenhum plano é ao mesmo tempo contratável e "em breve"', () => {
    for (const slug of PURCHASABLE_PLAN_SLUGS) {
      expect(isPlanComingSoon(slug)).toBe(false)
    }
  })
})

describe('POST /api/billing/checkout — barreira de disponibilidade', () => {
  it('Premium é rejeitado com 400 e mensagem neutra — mesmo com preço Premium ATIVO no catálogo', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL_ACTIVE])

    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'premium', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: PLAN_UNAVAILABLE_MESSAGE })
  })

  it('Premium rejeitado NUNCA toca Stripe, catálogo, Customer nem cria Checkout Session', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL_ACTIVE])

    await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'premium', interval: 'year', currency: 'USD' }))

    expect(getStripeClient).not.toHaveBeenCalled()
    expect(getCommercialPlanPricesCatalog).not.toHaveBeenCalled()
    expect(getOrCreateBillingCustomer).not.toHaveBeenCalled()
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('a resposta de rejeição não revela detalhe interno (nada de preço, catálogo, Stripe, ambiente ou chave)', async () => {
    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'premium', interval: 'month', currency: 'BRL' }))
    const text = JSON.stringify(await response.json())

    expect(text).not.toMatch(/price_|stripe|catálogo|catalog|ativo|active|sk_|whsec_/i)
  })

  it('Pro é permitido estruturalmente: com preço ativo, cria a Checkout Session e devolve a url', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL_ACTIVE])
    getOrCreateBillingCustomer.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
    createCheckoutSession.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' })

    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'pro', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.url).toBe('https://checkout.stripe.test/cs_test_1')
    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(createCheckoutSession.mock.calls[0][1]).toMatchObject({ stripePriceId: 'price_pro_month_brl', planSlug: 'pro' })
  })

  it('Pro sem preço ativo continua rejeitado pelo catálogo (a guarda é ADICIONAL a `active`, nunca a substitui)', async () => {
    getCommercialPlanPricesCatalog.mockResolvedValue([{ ...PRO_MONTH_BRL, active: false, stripePriceId: null }])

    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'pro', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(400)
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('plano inválido é rejeitado como payload inválido (400) antes de qualquer acesso externo', async () => {
    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'enterprise', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Payload inválido.' })
    expect(getStripeClient).not.toHaveBeenCalled()
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('Free continua com a mensagem própria (sem Checkout) e nunca chega ao Stripe', async () => {
    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'free', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Free') })
    expect(getStripeClient).not.toHaveBeenCalled()
  })

  it('sem sessão: 401, mesmo para Premium (a autenticação continua sendo a primeira barreira do usuário)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    const response = await checkoutPOST(jsonRequest('https://numora.test/api/billing/checkout', { planSlug: 'premium', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(401)
  })
})

describe('POST /api/billing/subscription/change-plan — barreira de disponibilidade', () => {
  it('tentativa Pro → Premium é rejeitada com 400 e mensagem neutra, sem chamar changeOwnPlan nem o Stripe', async () => {
    const response = await changePlanPOST(jsonRequest('https://numora.test/api/billing/subscription/change-plan', { planSlug: 'premium', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: PLAN_UNAVAILABLE_MESSAGE })
    expect(changeOwnPlanMock).not.toHaveBeenCalled()
    expect(getStripeClient).not.toHaveBeenCalled()
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('destino Pro (downgrade Premium → Pro) continua permitido', async () => {
    changeOwnPlanMock.mockResolvedValue({ kind: 'downgrade_scheduled', stripeSubscriptionId: 'sub_test_1', stripeScheduleId: 'sub_sched_1' })
    syncSubscriptionFromStripe.mockResolvedValue(undefined)

    const response = await changePlanPOST(jsonRequest('https://numora.test/api/billing/subscription/change-plan', { planSlug: 'pro', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ kind: 'downgrade_scheduled' })
    expect(changeOwnPlanMock).toHaveBeenCalledTimes(1)
  })

  it('plano inválido é rejeitado como payload inválido (400)', async () => {
    const response = await changePlanPOST(jsonRequest('https://numora.test/api/billing/subscription/change-plan', { planSlug: 'free', interval: 'month', currency: 'BRL' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Payload inválido.' })
    expect(changeOwnPlanMock).not.toHaveBeenCalled()
  })
})

describe('changeOwnPlan — defesa em profundidade (mesmo chamado direto, fora do Route Handler)', () => {
  function makeUntouchedSupabase() {
    const from = vi.fn()
    return { client: { from } as unknown as SupabaseClient, from }
  }

  it('destino Premium é rejeitado ANTES de ler subscription, catálogo ou chamar o Stripe (Pro → Premium)', async () => {
    const { client, from } = makeUntouchedSupabase()
    const stripe = { subscriptions: { retrieve: vi.fn(), update: vi.fn(), create: vi.fn() }, subscriptionSchedules: { create: vi.fn() } } as unknown as Stripe
    getCommercialPlanPricesCatalog.mockResolvedValue([PRO_MONTH_BRL, PREMIUM_MONTH_BRL_ACTIVE])

    await expect(realChangeOwnPlan(client, stripe, 'user-uuid-1', { planSlug: 'premium', interval: 'month', currency: 'BRL' })).rejects.toThrow(/não está disponível para contratação/)

    expect(from).not.toHaveBeenCalled()
    expect(getCommercialPlanPricesCatalog).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    expect(stripe.subscriptions.create).not.toHaveBeenCalled()
  })

  it('a mensagem de rejeição é a mesma mensagem neutra da API', async () => {
    const { client } = makeUntouchedSupabase()
    const stripe = {} as unknown as Stripe

    await expect(realChangeOwnPlan(client, stripe, 'user-uuid-1', { planSlug: 'premium', interval: 'year', currency: 'USD' })).rejects.toThrow(PLAN_UNAVAILABLE_MESSAGE)
  })

  it('destino Pro passa pela guarda (segue para a leitura da subscription do usuário)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const inFn = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ in: inFn })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const client = { from } as unknown as SupabaseClient

    // Sem subscription elegível o fluxo falha DEPOIS da guarda — prova que a guarda não bloqueou o destino Pro.
    await expect(realChangeOwnPlan(client, {} as unknown as Stripe, 'user-uuid-1', { planSlug: 'pro', interval: 'month', currency: 'BRL' })).rejects.toThrow(/Nenhuma subscription elegível/)
    expect(from).toHaveBeenCalledWith('subscriptions')
  })
})
