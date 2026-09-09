/**
 * lib/stripe/portal.ts
 * Etapa "Stripe 5.6 — Customer Portal" — cria uma Stripe Billing Portal
 * Session para o Customer do usuário autenticado.
 *
 * A Portal Configuration usada (a padrão da conta, ver
 * `docs`/relatório desta etapa) habilita só `invoice_history` e
 * `payment_method_update` — `subscription_update`/`subscription_cancel`
 * ficam desabilitados de propósito (decisão de negócio já aprovada: plan
 * switching e cancelamento continuam centralizados nas rotas próprias do
 * Numora, nunca no Portal). Este módulo nunca decide isso em código — é
 * configuração do lado do Stripe.
 */
import type Stripe from 'stripe'

export interface CreateBillingPortalSessionParams {
  /** Sempre resolvido pelo servidor via `billing_customers` — nunca aceito do cliente. */
  stripeCustomerId: string
  returnUrl: string
}

export async function createBillingPortalSession(stripe: Stripe, params: CreateBillingPortalSessionParams): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: params.returnUrl,
  })
}
