/**
 * lib/billing/checkout-return.ts
 * Etapa "B1 — Official Launch, código de cobrança" — resolve o retorno do
 * Stripe Checkout (`/dashboard?checkout=success&session_id=...`) no
 * SERVIDOR. A URL NUNCA é prova de pagamento e nunca concede acesso: a
 * autoridade é exclusivamente
 *   1. a sessão autenticada (`userId`);
 *   2. a Checkout Session RECUPERADA no Stripe com `session_id`;
 *   3. `session.client_reference_id === userId` (gravado por
 *      `createCheckoutSession` a partir do usuário autenticado);
 *   4. o estado real da Session;
 *   5. a sincronização IDEMPOTENTE já existente
 *      (`syncSubscriptionFromStripe`, identidade por `stripe_subscription_id`,
 *      que ainda valida Customer↔usuário via `billing_customers` e metadata).
 * O acesso ao plano continua derivando só de `subscriptions.status` via
 * `effective_plans()` — este módulo apenas ADIANTA a convergência que o
 * webhook faria (o webhook continua sendo o caminho canônico e idempotente:
 * rodar os dois nunca duplica nada).
 *
 * `session_id` de outro usuário, inexistente, expirado, de outro modo que
 * não `subscription`, ou com formato inválido resolve sempre para o MESMO
 * resultado neutro (`invalid`) — nunca um oráculo do que existe no Stripe,
 * nunca sincroniza nada, nunca expõe dado da Session.
 *
 * Este módulo não decide nada sobre preço, moeda ou elegibilidade (isso é
 * `purchase-eligibility.ts`, aplicado ANTES de a Session existir).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'

export type CheckoutReturnOutcome = 'confirmed' | 'pending' | 'invalid' | 'unavailable'

/** Formato de um Checkout Session ID (`cs_test_...`/`cs_live_...`) — rejeita lixo ANTES de qualquer chamada ao Stripe. */
export const CHECKOUT_SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{8,200}$/

/** Estados de subscription que contam como "contratação confirmada" para a mensagem de sucesso. */
const CONFIRMED_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing']

export interface ResolveCheckoutReturnDeps {
  stripe: Stripe
  adminClient: SupabaseClient
  userId: string
  sessionId: string
  /** Erros de infraestrutura (Stripe/banco) vão para observabilidade; nunca para o usuário. */
  reportError?: (error: unknown) => void
}

function isStripeResourceMissing(error: unknown): boolean {
  const candidate = error as { code?: string; type?: string } | null
  return candidate?.code === 'resource_missing' || candidate?.type === 'StripeInvalidRequestError'
}

export async function resolveCheckoutReturn({ stripe, adminClient, userId, sessionId, reportError }: ResolveCheckoutReturnDeps): Promise<CheckoutReturnOutcome> {
  if (typeof sessionId !== 'string' || !CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
    return 'invalid'
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    if (isStripeResourceMissing(err)) {
      return 'invalid'
    }
    reportError?.(err)
    return 'unavailable'
  }

  // Dono da Session: SEMPRE o usuário autenticado. Nunca sincroniza nada para outra conta.
  if (session.client_reference_id !== userId || session.mode !== 'subscription') {
    return 'invalid'
  }

  if (session.status === 'expired') {
    return 'invalid'
  }

  // Session ainda aberta (o usuário não terminou) ou pagamento assíncrono ainda não confirmado: nada a conceder.
  if (session.status !== 'complete' || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required')) {
    return 'pending'
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null)
  if (!subscriptionId) {
    return 'pending'
  }

  try {
    const result = await syncSubscriptionFromStripe(adminClient, stripe, subscriptionId, null)

    if (result.outcome === 'skipped') {
      // Ex.: Customer de uma conta já excluída (tombstone) — nunca reassociado.
      return 'invalid'
    }

    return CONFIRMED_SUBSCRIPTION_STATUSES.includes(result.newStatus) ? 'confirmed' : 'pending'
  } catch (err) {
    // Sync ainda não possível (ex.: vínculo de Customer/Price ainda não disponível localmente): o webhook é o caminho canônico e converge sozinho.
    reportError?.(err)
    return 'pending'
  }
}
