/**
 * tests/unit/stripe-portal.test.ts
 * Etapa "Stripe 5.6 — Customer Portal" — `createBillingPortalSession`
 * (lib/stripe/portal.ts), com Stripe MOCKADO.
 */
import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

import { createBillingPortalSession } from '@/lib/stripe/portal'

describe('createBillingPortalSession', () => {
  it('cria a sessão com o Customer e return_url exatos recebidos — nunca inventa nenhum dos dois', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'bps_test_1', url: 'https://billing.stripe.com/session/test' })
    const stripe = { billingPortal: { sessions: { create } } } as unknown as Stripe

    const session = await createBillingPortalSession(stripe, { stripeCustomerId: 'cus_test_abc', returnUrl: 'https://numora.test/dashboard/profile' })

    expect(create).toHaveBeenCalledWith({ customer: 'cus_test_abc', return_url: 'https://numora.test/dashboard/profile' })
    expect(session.url).toBe('https://billing.stripe.com/session/test')
  })

  it('propaga erro do Stripe sem mascarar', async () => {
    const create = vi.fn().mockRejectedValue(new Error('No configuration provided (simulado)'))
    const stripe = { billingPortal: { sessions: { create } } } as unknown as Stripe

    await expect(createBillingPortalSession(stripe, { stripeCustomerId: 'cus_test_abc', returnUrl: 'https://numora.test/dashboard/profile' })).rejects.toThrow(/No configuration/)
  })
})
