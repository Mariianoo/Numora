/**
 * lib/stripe/dashboard-links.ts
 * Etapa "Admin Subscriptions V1" — monta links READ-ONLY para o Stripe
 * Dashboard (Customer/Subscription), a partir dos IDs reais já carregados
 * pelo repository. Puramente navegação: nenhum SDK do Stripe no browser,
 * nenhuma chamada de API, nenhum secret — só uma URL de string.
 *
 * `/test/`: hardcoded de propósito. Toda assinatura visível nesta V1 (DEV,
 * e qualquer ambiente hoje) é necessariamente Stripe TEST — o projeto nunca
 * cria Product/Price/Customer/Subscription LIVE (ver
 * `lib/stripe/assert-test-mode.ts`/`lib/billing/assert-billing-environment.ts`).
 * Sem o prefixo `/test/`, o Dashboard mostraria "Nenhum resultado" caso o
 * admin esteja com o toggle "Modo de teste" desligado. Se este projeto um
 * dia processar assinaturas LIVE de verdade em Production, este helper
 * precisará decidir o prefixo a partir do modo real da chave/ambiente —
 * decisão explicitamente fora do escopo desta V1 (não implementada aqui).
 */
const STRIPE_DASHBOARD_TEST_BASE = 'https://dashboard.stripe.com/test'

export function buildStripeCustomerDashboardUrl(stripeCustomerId: string): string {
  return `${STRIPE_DASHBOARD_TEST_BASE}/customers/${encodeURIComponent(stripeCustomerId)}`
}

export function buildStripeSubscriptionDashboardUrl(stripeSubscriptionId: string): string {
  return `${STRIPE_DASHBOARD_TEST_BASE}/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`
}

/** Etapa "Admin Transactions V1" — mesmo padrão/mesma ressalva de `/test/` acima, aplicado a Invoice/Payment Intent. */
export function buildStripeInvoiceDashboardUrl(stripeInvoiceId: string): string {
  return `${STRIPE_DASHBOARD_TEST_BASE}/invoices/${encodeURIComponent(stripeInvoiceId)}`
}

export function buildStripePaymentIntentDashboardUrl(stripePaymentIntentId: string): string {
  return `${STRIPE_DASHBOARD_TEST_BASE}/payments/${encodeURIComponent(stripePaymentIntentId)}`
}
