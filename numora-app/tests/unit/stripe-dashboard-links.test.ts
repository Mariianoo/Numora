import { describe, expect, it } from 'vitest'

import {
  buildStripeCustomerDashboardUrl,
  buildStripeInvoiceDashboardUrl,
  buildStripePaymentIntentDashboardUrl,
  buildStripeSubscriptionDashboardUrl,
} from '@/lib/stripe/dashboard-links'

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

describe('buildStripeInvoiceDashboardUrl / buildStripePaymentIntentDashboardUrl — Etapa "Admin Transactions V1"', () => {
  it('monta a URL com o ID REAL (nunca mascarado) no path', () => {
    expect(buildStripeInvoiceDashboardUrl('in_1234567890abcdef')).toBe('https://dashboard.stripe.com/test/invoices/in_1234567890abcdef')
    expect(buildStripePaymentIntentDashboardUrl('pi_1234567890abcdef')).toBe('https://dashboard.stripe.com/test/payments/pi_1234567890abcdef')
  })

  it('sempre no modo /test/ (mesma ressalva já documentada para customer/subscription)', () => {
    expect(buildStripeInvoiceDashboardUrl('in_x')).toContain('/test/invoices/')
    expect(buildStripePaymentIntentDashboardUrl('pi_x')).toContain('/test/payments/')
  })

  it('faz URL-encode do ID (defesa contra qualquer caractere inesperado)', () => {
    expect(buildStripeInvoiceDashboardUrl('in_abc def')).toBe('https://dashboard.stripe.com/test/invoices/in_abc%20def')
    expect(buildStripePaymentIntentDashboardUrl('pi_abc def')).toBe('https://dashboard.stripe.com/test/payments/pi_abc%20def')
  })
})
