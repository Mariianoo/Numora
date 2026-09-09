/**
 * lib/stripe/subscription-sync.ts
 * Etapa "Stripe 5.4B — Subscription Sync" — sincroniza o estado CANÔNICO
 * de uma subscription do Stripe TEST MODE para `public.subscriptions`.
 *
 * REGRA PRINCIPAL (FASE 8): o evento nunca é a fonte final da verdade.
 * Para `customer.subscription.created/updated/deleted`, sempre buscamos
 * `stripe.subscriptions.retrieve(subscriptionId)` — o estado ATUAL no
 * Stripe — nunca confiamos no snapshot embutido no payload do evento.
 * Isso protege contra eventos fora de ordem, retries e updates rápidos em
 * sequência: não importa qual evento chegou por último, o resultado final
 * sempre reflete o que o Stripe diz ser verdade agora.
 *
 * NÃO escreve entitlements/benefit_grants/cache de plano efetivo —
 * `effective_plans()` continua sendo a única fonte de acesso, derivando
 * sempre de `subscriptions.status` ao vivo (nunca alterada por esta etapa).
 *
 * NÃO cria `billing_customers` — se o Stripe Customer da subscription não
 * tiver vínculo local (Customer Foundation, Stripe 5.2, é quem cria esse
 * vínculo), falha explicitamente. NÃO cria `plans`/`plan_prices` — se o
 * Stripe Price não corresponder a nenhuma linha local, falha
 * explicitamente. Nenhum dos dois é corrigido/inventado automaticamente.
 *
 * Etapa "Stripe 5.5 — Invoice & Payment Sync": `syncFromRecognizedWebhookEvent`
 * (o dispatcher chamado pela rota do webhook) passou a delegar
 * `invoice.paid`/`invoice.payment_failed` para `lib/stripe/invoice-sync.ts`
 * — sincronização financeira (`billing_transactions`), inteiramente
 * separada desta (nunca toca `subscriptions`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { resolveBillingCustomerByStripeCustomerId } from './customer'
import { dispatchWebhookEvent } from './webhook'
import { syncInvoicePaid, syncInvoicePaymentFailed, type SyncInvoiceResult } from './invoice-sync'

export interface SyncSubscriptionResult {
  outcome: 'synced'
  subscriptionId: string
  previousStatus: string | null
  newStatus: string
  transitionRecorded: boolean
}

export interface SkippedSyncResult {
  outcome: 'skipped'
  reason: string
}

function toIsoTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}

function toNullableIsoTimestamp(unixSeconds: number | null | undefined): string | null {
  return unixSeconds === null || unixSeconds === undefined ? null : toIsoTimestamp(unixSeconds)
}

/**
 * FASE 11/12: o Price ID é a única autoridade para resolver o plano —
 * nunca amount/currency/interval/metadata. Resolve contra QUALQUER linha
 * de `plan_prices` (ativa ou histórica) — grandfathering exige encontrar
 * mesmo um Price antigo/inativo, nunca substituí-lo pelo preço ativo
 * atual da mesma combinação comercial.
 */
async function resolvePlanIdByStripePriceId(supabase: SupabaseClient, stripePriceId: string): Promise<string> {
  const { data, error } = await supabase.from('plan_prices').select('plan_id').eq('stripe_price_id', stripePriceId).maybeSingle()

  if (error) {
    throw new Error(`[subscription-sync] Falha ao consultar plan_prices para stripe_price_id ${stripePriceId}: ${error.message}`)
  }
  if (!data) {
    throw new Error(`[subscription-sync] Stripe Price ${stripePriceId} não corresponde a nenhuma linha local de plan_prices — subscription não sincronizada.`)
  }

  return data.plan_id as string
}

interface SyncSubscriptionRpcRow {
  subscription_id: string
  previous_status: string | null
  new_status: string
  transition_recorded: boolean
}

/**
 * Busca o estado CANÔNICO da subscription no Stripe (FASE 8), resolve
 * Customer→user e Price→plan localmente, e persiste via a RPC atômica
 * `sync_subscription_from_stripe` (create if missing, update if existing —
 * identidade por `stripe_subscription_id`, nunca duas linhas para a mesma
 * subscription Stripe).
 */
export async function syncSubscriptionFromStripe(
  supabase: SupabaseClient,
  stripe: Stripe,
  stripeSubscriptionId: string,
  stripeEventId: string | null,
): Promise<SyncSubscriptionResult> {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)

  const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
  const billingCustomer = await resolveBillingCustomerByStripeCustomerId(supabase, stripeCustomerId)

  // FASE 10 — validação adicional: se a subscription/Customer carregar
  // numora_user_id em metadata, precisa ser consistente com o que
  // billing_customers já resolveu. Nunca escolhe arbitrariamente entre os
  // dois — diverge = falha explícita.
  const metadataUserId = subscription.metadata?.numora_user_id
  if (metadataUserId && metadataUserId !== billingCustomer.userId) {
    throw new Error(
      `[subscription-sync] Inconsistência: subscription.metadata.numora_user_id (${metadataUserId}) diverge do user_id resolvido via billing_customers (${billingCustomer.userId}) para o Stripe Customer ${stripeCustomerId}.`,
    )
  }

  const items = subscription.items.data
  if (items.length !== 1) {
    throw new Error(
      `[subscription-sync] subscription ${subscription.id} tem ${items.length} item(ns) — o modelo comercial do Numora espera exatamente 1 item por subscription; não há como resolver "o" plano sem ambiguidade.`,
    )
  }
  const item = items[0]
  const stripePriceId = typeof item.price === 'string' ? item.price : item.price.id
  const planId = await resolvePlanIdByStripePriceId(supabase, stripePriceId)

  const { data, error } = await supabase
    .rpc('sync_subscription_from_stripe', {
      p_user_id: billingCustomer.userId,
      p_billing_customer_id: billingCustomer.id,
      p_stripe_subscription_id: subscription.id,
      p_stripe_price_id: stripePriceId,
      p_plan_id: planId,
      p_status: subscription.status,
      p_current_period_start: toIsoTimestamp(item.current_period_start),
      p_current_period_end: toIsoTimestamp(item.current_period_end),
      p_cancel_at_period_end: subscription.cancel_at_period_end,
      p_canceled_at: toNullableIsoTimestamp(subscription.canceled_at),
      p_trial_end: toNullableIsoTimestamp(subscription.trial_end),
      p_stripe_event_id: stripeEventId,
      p_source: 'webhook',
    })
    .single()

  if (error) {
    throw new Error(`[subscription-sync] Falha ao sincronizar subscription ${subscription.id}: ${error.message}`)
  }

  const row = data as SyncSubscriptionRpcRow
  return {
    outcome: 'synced',
    subscriptionId: row.subscription_id,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    transitionRecorded: row.transition_recorded,
  }
}

/**
 * FASE 9: `checkout.session.completed` só é útil aqui pela subscription
 * que ela referencia — nunca cria uma subscription local "porque a Session
 * terminou"; se não houver `session.subscription`, não há nada para
 * sincronizar (nunca inventa uma subscription).
 */
export async function syncSubscriptionFromCheckoutSession(
  supabase: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  stripeEventId: string | null,
): Promise<SyncSubscriptionResult | SkippedSyncResult> {
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null)

  if (!subscriptionId) {
    return { outcome: 'skipped', reason: `checkout.session ${session.id} não possui subscription associada.` }
  }

  return syncSubscriptionFromStripe(supabase, stripe, subscriptionId, stripeEventId)
}

/**
 * Orquestração chamada pela rota do webhook DEPOIS de
 * `dispatchWebhookEvent` (lib/stripe/webhook.ts, Stripe 5.4A, inalterado)
 * confirmar que o tipo é reconhecido. Etapa "Stripe 5.5": `invoice.paid`/
 * `invoice.payment_failed` agora delegam para `lib/stripe/invoice-sync.ts`
 * (sincronização financeira, `billing_transactions` — nunca toca
 * `subscriptions`). Qualquer outro tipo não tratado aqui continua no-op de
 * propósito (fora de escopo).
 */
export async function syncFromRecognizedWebhookEvent(supabase: SupabaseClient, stripe: Stripe, event: Stripe.Event): Promise<SyncSubscriptionResult | SyncInvoiceResult | SkippedSyncResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return syncSubscriptionFromCheckoutSession(supabase, stripe, event.data.object as Stripe.Checkout.Session, event.id)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscriptionObject = event.data.object as Stripe.Subscription
      return syncSubscriptionFromStripe(supabase, stripe, subscriptionObject.id, event.id)
    }
    case 'invoice.paid': {
      const invoiceObject = event.data.object as Stripe.Invoice
      return syncInvoicePaid(supabase, stripe, invoiceObject.id)
    }
    case 'invoice.payment_failed': {
      const invoiceObject = event.data.object as Stripe.Invoice
      return syncInvoicePaymentFailed(supabase, stripe, invoiceObject.id)
    }
    default:
      return { outcome: 'skipped', reason: `evento ${event.type} não envolve sincronização de subscription/invoice nesta etapa.` }
  }
}

/** Reexportado por conveniência — evita o Route Handler importar de dois módulos para uma única decisão de "processar ou não". */
export { dispatchWebhookEvent }
