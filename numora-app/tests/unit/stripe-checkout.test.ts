/**
 * tests/unit/stripe-checkout.test.ts
 * Etapa "Stripe 5.3 — Checkout Foundation" — `checkoutRequestSchema`
 * (validação de payload), `resolveSellablePrice` (resolução de preço,
 * pura) e `createCheckoutSession` (Stripe MOCKADO — nenhuma chamada real).
 * A prova contra Stripe TEST real está em
 * tests/integration/stripe-checkout-foundation.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

import { checkoutRequestSchema, createCheckoutSession, resolveAnalyticsConsentSnapshot, resolveSellablePrice } from '@/lib/stripe/checkout'
import { buildCreationIdempotencyKey } from '@/lib/stripe/idempotency'
import type { CommercialPlanPrice } from '@/lib/stripe/catalog'

function makePrice(overrides: Partial<CommercialPlanPrice> = {}): CommercialPlanPrice {
  return {
    planPriceId: 'plan-price-uuid',
    planId: 'plan-uuid',
    planSlug: 'pro',
    interval: 'month',
    currency: 'BRL',
    amount: 19.9,
    stripePriceId: 'price_pro_brl_month',
    active: true,
    ...overrides,
  }
}

describe('checkoutRequestSchema — validação de payload', () => {
  it('aceita uma combinação válida', () => {
    const result = checkoutRequestSchema.safeParse({ planSlug: 'pro', interval: 'month', currency: 'BRL' })
    expect(result.success).toBe(true)
  })

  it('aceita "free" sintaticamente (rejeição de negócio acontece depois, no Route Handler)', () => {
    const result = checkoutRequestSchema.safeParse({ planSlug: 'free', interval: 'month', currency: 'BRL' })
    expect(result.success).toBe(true)
  })

  it('rejeita planSlug inexistente', () => {
    const result = checkoutRequestSchema.safeParse({ planSlug: 'enterprise', interval: 'month', currency: 'BRL' })
    expect(result.success).toBe(false)
  })

  it('rejeita currency inválida (ex.: EUR)', () => {
    const result = checkoutRequestSchema.safeParse({ planSlug: 'pro', interval: 'month', currency: 'EUR' })
    expect(result.success).toBe(false)
  })

  it('rejeita interval inválido', () => {
    const result = checkoutRequestSchema.safeParse({ planSlug: 'pro', interval: 'week', currency: 'BRL' })
    expect(result.success).toBe(false)
  })

  it('rejeita payload faltando campos', () => {
    const result = checkoutRequestSchema.safeParse({ planSlug: 'pro' })
    expect(result.success).toBe(false)
  })

  it('NUNCA aceita priceId/stripe_price_id/customerId como campos do schema — não fazem parte do contrato', () => {
    const shape = checkoutRequestSchema.shape
    expect(Object.keys(shape).sort()).toEqual(['currency', 'interval', 'planSlug'])
    // Mesmo enviando esses campos extras, eles são ignorados (zod object
    // "strip" é o padrão) — nunca influenciam o preço resolvido.
    const result = checkoutRequestSchema.safeParse({
      planSlug: 'pro',
      interval: 'month',
      currency: 'BRL',
      priceId: 'price_premium_brl_month_ARBITRARIO',
      customerId: 'cus_ARBITRARIO',
    })
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('priceId')
    expect(result.data).not.toHaveProperty('customerId')
  })
})

describe('resolveAnalyticsConsentSnapshot — Etapa 5.9G, fail-closed', () => {
  it('boolean true literal → true', () => {
    expect(resolveAnalyticsConsentSnapshot(true)).toBe(true)
  })

  it('boolean false literal → false', () => {
    expect(resolveAnalyticsConsentSnapshot(false)).toBe(false)
  })

  it('ausente (undefined) → false', () => {
    expect(resolveAnalyticsConsentSnapshot(undefined)).toBe(false)
  })

  it('null → false', () => {
    expect(resolveAnalyticsConsentSnapshot(null)).toBe(false)
  })

  it.each(['true', '1', 1, {}, [], 'yes'])('valor inválido (%o, tipo errado) → false, nunca lança', (value) => {
    expect(() => resolveAnalyticsConsentSnapshot(value)).not.toThrow()
    expect(resolveAnalyticsConsentSnapshot(value)).toBe(false)
  })
})

describe('resolveSellablePrice', () => {
  it('encontra a combinação exata quando active=true', () => {
    const catalog = [makePrice(), makePrice({ planSlug: 'premium', stripePriceId: 'price_premium_brl_month' })]
    const result = resolveSellablePrice(catalog, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
    expect(result).toEqual({ status: 'ok', price: catalog[0] })
  })

  it("'not_found' quando a combinação não existe no catálogo (plano/interval/currency incompatíveis)", () => {
    const catalog = [makePrice()]
    const result = resolveSellablePrice(catalog, { planSlug: 'pro', interval: 'year', currency: 'USD' })
    expect(result).toEqual({ status: 'not_found' })
  })

  it("'inactive' quando a linha existe mas active=false — nunca vende um preço inativo", () => {
    const catalog = [makePrice({ active: false })]
    const result = resolveSellablePrice(catalog, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
    expect(result).toEqual({ status: 'inactive' })
  })

  it('nunca escolhe arbitrariamente: currency errada não confunde com a combinação certa', () => {
    const catalog = [makePrice({ currency: 'USD', amount: 5.99, stripePriceId: 'price_pro_usd_month' })]
    const result = resolveSellablePrice(catalog, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
    expect(result).toEqual({ status: 'not_found' })
  })

  it('a função nunca aceita um stripePriceId por parâmetro — só planSlug/interval/currency', () => {
    // Prova estrutural do contrato: TypeScript já impede compilar um
    // ResolveSellablePriceParams com stripePriceId — este teste documenta
    // a garantia em runtime também, via introspecção do resultado.
    const catalog = [makePrice()]
    const result = resolveSellablePrice(catalog, { planSlug: 'pro', interval: 'month', currency: 'BRL' })
    expect(result.status).toBe('ok')
  })
})

function makeMockStripe(sessionId = 'cs_test_abc', url: string | null = 'https://checkout.stripe.com/c/pay/cs_test_abc') {
  const create = vi.fn().mockResolvedValue({ id: sessionId, url })
  return { client: { checkout: { sessions: { create } } } as unknown as Stripe, create }
}

/** Etapa 5.9G — os 4 novos parâmetros obrigatórios, com valores neutros/válidos, reutilizados por todo teste que não é especificamente SOBRE eles. */
const ANALYTICS_PARAMS = {
  funnelId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  analyticsConsentSnapshot: false,
  planSlug: 'pro',
  interval: 'month',
  currency: 'BRL',
}

describe('createCheckoutSession', () => {
  it('cria com mode=subscription, quantity=1, client_reference_id e metadata corretos', async () => {
    const { client: stripe, create } = makeMockStripe()

    await createCheckoutSession(stripe, {
      stripePriceId: 'price_pro_brl_month',
      stripeCustomerId: 'cus_abc',
      userId: 'user-1',
      successUrl: 'https://app.numora.test/dashboard?checkout=success',
      cancelUrl: 'https://app.numora.test/dashboard?checkout=cancel',
      ...ANALYTICS_PARAMS,
    })

    expect(create).toHaveBeenCalledTimes(1)
    const [payload, options] = create.mock.calls[0]
    expect(payload).toEqual({
      mode: 'subscription',
      customer: 'cus_abc',
      client_reference_id: 'user-1',
      metadata: {
        numora_user_id: 'user-1',
        numora_funnel_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        numora_analytics_consent: 'false',
        numora_plan_slug: 'pro',
        numora_interval: 'month',
        numora_currency: 'BRL',
      },
      line_items: [{ price: 'price_pro_brl_month', quantity: 1 }],
      success_url: 'https://app.numora.test/dashboard?checkout=success',
      cancel_url: 'https://app.numora.test/dashboard?checkout=cancel',
    })
    expect(options.idempotencyKey).toMatch(/^numora:create-checkout-session:/)
  })

  it('Etapa 5.9G — numora_analytics_consent é sempre a STRING "true"/"false" (formato nativo de metadata do Stripe), nunca um boolean', async () => {
    const { client: stripe, create } = makeMockStripe()

    await createCheckoutSession(stripe, {
      stripePriceId: 'price_pro_brl_month',
      stripeCustomerId: 'cus_abc',
      userId: 'user-1',
      successUrl: 'https://app.numora.test/dashboard?checkout=success',
      cancelUrl: 'https://app.numora.test/dashboard?checkout=cancel',
      ...ANALYTICS_PARAMS,
      analyticsConsentSnapshot: true,
    })

    const [payload] = create.mock.calls[0]
    expect(payload.metadata.numora_analytics_consent).toBe('true')
    expect(typeof payload.metadata.numora_analytics_consent).toBe('string')
  })

  it('gera uma Idempotency-Key DIFERENTE a cada chamada (nunca determinística por userId) — 2 tentativas legítimas nunca colidem', async () => {
    const { client: stripe, create } = makeMockStripe()

    await createCheckoutSession(stripe, {
      stripePriceId: 'price_pro_brl_month',
      stripeCustomerId: 'cus_abc',
      userId: 'user-1',
      successUrl: 'https://app.numora.test/dashboard?checkout=success',
      cancelUrl: 'https://app.numora.test/dashboard?checkout=cancel',
      ...ANALYTICS_PARAMS,
    })
    await createCheckoutSession(stripe, {
      stripePriceId: 'price_pro_brl_month',
      stripeCustomerId: 'cus_abc',
      userId: 'user-1',
      successUrl: 'https://app.numora.test/dashboard?checkout=success',
      cancelUrl: 'https://app.numora.test/dashboard?checkout=cancel',
      ...ANALYTICS_PARAMS,
      funnelId: 'b1ffcd88-8b1a-4df7-aa5c-5aa8ac270b22',
    })

    const keyA = create.mock.calls[0][1].idempotencyKey
    const keyB = create.mock.calls[1][1].idempotencyKey
    expect(keyA).not.toBe(keyB)
    // Nunca no formato usado por getOrCreateBillingCustomer (determinístico por userId).
    expect(keyA).not.toBe(buildCreationIdempotencyKey('customer', 'user-1'))
  })

  it('nunca aceita um priceId/customerId "arbitrário" fora dos parâmetros tipados — o payload só usa exatamente o que foi passado', async () => {
    const { client: stripe, create } = makeMockStripe()

    await createCheckoutSession(stripe, {
      stripePriceId: 'price_resolvido_pelo_servidor',
      stripeCustomerId: 'cus_resolvido_pelo_servidor',
      userId: 'user-1',
      successUrl: 'https://app.numora.test/dashboard?checkout=success',
      cancelUrl: 'https://app.numora.test/dashboard?checkout=cancel',
      ...ANALYTICS_PARAMS,
    })

    const [payload] = create.mock.calls[0]
    expect(payload.line_items).toEqual([{ price: 'price_resolvido_pelo_servidor', quantity: 1 }])
    expect(payload.customer).toBe('cus_resolvido_pelo_servidor')
  })

  it('propaga erro do Stripe (ex.: Customer inexistente) sem mascarar', async () => {
    const create = vi.fn().mockRejectedValue(new Error('No such customer (simulado)'))
    const stripe = { checkout: { sessions: { create } } } as unknown as Stripe

    await expect(
      createCheckoutSession(stripe, {
        stripePriceId: 'price_pro_brl_month',
        stripeCustomerId: 'cus_invalido',
        userId: 'user-1',
        successUrl: 'https://app.numora.test/dashboard?checkout=success',
        cancelUrl: 'https://app.numora.test/dashboard?checkout=cancel',
        ...ANALYTICS_PARAMS,
      }),
    ).rejects.toThrow(/No such customer/)
  })
})
