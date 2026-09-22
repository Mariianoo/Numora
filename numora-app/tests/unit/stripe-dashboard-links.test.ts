import { describe, expect, it } from 'vitest'

import { buildStripeCustomerDashboardUrl, buildStripeSubscriptionDashboardUrl } from '@/lib/stripe/dashboard-links'

describe('buildStripeCustomerDashboardUrl / buildStripeSubscriptionDashboardUrl', () => {
  it('monta a URL com o ID REAL (nunca mascarado) no path', () => {
    expect(buildStripeCustomerDashboardUrl('cus_1234567890abcdef')).toBe('https://dashboard.stripe.com/test/customers/cus_1234567890abcdef')
    expect(buildStripeSubscriptionDashboardUrl('sub_1234567890abcdef')).toBe('https://dashboard.stripe.com/test/subscriptions/sub_1234567890abcdef')
  })

  it('sempre no modo /test/ (todo dado desta V1 é Stripe TEST — ver comentário do arquivo)', () => {
    expect(buildStripeCustomerDashboardUrl('cus_x')).toContain('/test/customers/')
    expect(buildStripeSubscriptionDashboardUrl('sub_x')).toContain('/test/subscriptions/')
  })

  it('faz URL-encode do ID (defesa contra qualquer caractere inesperado)', () => {
    expect(buildStripeCustomerDashboardUrl('cus_abc def')).toBe('https://dashboard.stripe.com/test/customers/cus_abc%20def')
  })
})
