/**
 * lib/stripe/invoice-sync.ts
 * Etapa "Stripe 5.5 — Invoice & Payment Sync" — sincroniza o resultado
 * financeiro de um Invoice do Stripe TEST MODE para `public.billing_transactions`.
 *
 * Sempre busca o Invoice CANÔNICO via `stripe.invoices.retrieve()` (mesma
 * filosofia da Stripe 5.4B: nunca confiar no snapshot embutido no payload
 * do evento para os DADOS do invoice — customer/subscription/payment_intent/
 * amount/currency/metadata). O `status` gravado localmente ('paid'/'failed')
 * é determinado por QUAL evento chamou esta sincronização
 * (`invoice.paid`/`invoice.payment_failed`), não por `invoice.status` do
 * Stripe (que tem seu próprio enum — draft/open/paid/uncollectible/void —
 * sem um valor literal "failed").
 *
 * NÃO cria `billing_customers` nem `subscriptions` — se o Customer não
 * tiver vínculo local, falha explicitamente (Customer Foundation, Stripe
 * 5.2, é quem cria esse vínculo). Se a subscription local ainda não
 * existir, o invoice AINDA é registrado (FASE 6) — só com
 * `subscription_id = null`; o Subscription Sync (Stripe 5.4B) continua
 * sendo o único responsável por criar/atualizar `subscriptions`.
 *
 * NÃO altera `subscriptions.status` — `invoice.payment_failed` nunca
 * cancela/degrada uma subscription por conta própria (isso seria
 * responsabilidade do Subscription Sync, refletindo o estado canônico do
 * Stripe quando ele próprio decidir mudar o status da subscription).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { resolveBillingCustomerByStripeCustomerId } from './customer'
import { fromStripeMinorUnits } from './minor-units'

const SUPPORTED_CURRENCIES = ['BRL', 'USD'] as const
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export interface SyncInvoiceResult {
  outcome: 'synced'
  transactionId: string
  previousStatus: string | null
  newStatus: string
}

/**
 * FASE 2: só BRL/USD são suportadas nesta etapa — nenhuma outra moeda é
 * aceita, mesmo que o Stripe TEST algum dia devolva uma (nunca inventa
 * suporte, falha explicitamente).
 */
function normalizeCurrency(stripeCurrency: string): SupportedCurrency {
  const upper = stripeCurrency.toUpperCase()
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(upper)) {
    throw new Error(`[invoice-sync] Moeda "${stripeCurrency}" não é suportada pelo Numora nesta etapa (só BRL/USD).`)
  }
  return upper as SupportedCurrency
}

/**
 * Nesta versão da API do Stripe, `Invoice` não tem mais um campo
 * `subscription` de nível superior — a referência vive em
 * `invoice.parent.subscription_details.subscription` (`parent` é `null`
 * quando o invoice não veio de uma subscription, ex.: fatura avulsa).
 */
function extractStripeSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription
  if (!subscription) return null
  return typeof subscription === 'string' ? subscription : subscription.id
}

/**
 * Idem para `payment_intent`: não é mais um campo direto de `Invoice` —
 * vive em `invoice.payments.data[].payment.payment_intent`. Pega o
 * primeiro pagamento do tipo `payment_intent` (o modelo comercial do
 * Numora nunca gera mais de um pagamento por invoice). Ausência é
 * aceitável (FASE 5) — nunca inventa um valor, nunca falha só por isso.
 */
function extractStripePaymentIntentId(invoice: Stripe.Invoice): string | null {
  for (const invoicePayment of invoice.payments?.data ?? []) {
    const paymentIntent = invoicePayment.payment.payment_intent
    if (paymentIntent) {
      return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id
    }
  }
  return null
}

/**
 * FASE 6: ausência de subscription local é ACEITA (retorna `null`) — nunca
 * cria a subscription aqui, nunca faz o invoice falhar só por causa disso.
 */
async function resolveLocalSubscriptionId(supabase: SupabaseClient, stripeSubscriptionId: string | null): Promise<string | null> {
  if (!stripeSubscriptionId) return null

  const { data, error } = await supabase.from('subscriptions').select('id').eq('stripe_subscription_id', stripeSubscriptionId).maybeSingle()
  if (error) {
    throw new Error(`[invoice-sync] Falha ao consultar subscriptions para stripe_subscription_id ${stripeSubscriptionId}: ${error.message}`)
  }

  return data ? (data.id as string) : null
}

interface SyncBillingTransactionRpcRow {
  transaction_id: string
  previous_status: string | null
  new_status: string
}

async function syncInvoiceTransaction(supabase: SupabaseClient, invoice: Stripe.Invoice, status: 'paid' | 'failed', amountMinorUnits: number, paidAtUnix: number | null): Promise<SyncInvoiceResult> {
  const stripeCustomerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null)
  if (!stripeCustomerId) {
    throw new Error(`[invoice-sync] invoice ${invoice.id} não tem customer associado — não é possível resolver o usuário.`)
  }

  const billingCustomer = await resolveBillingCustomerByStripeCustomerId(supabase, stripeCustomerId)

  // FASE 7 — mesma regra de segurança do Subscription Sync (Stripe 5.4B):
  // metadata só valida, nunca decide sozinha; divergência é falha explícita.
  const metadataUserId = invoice.metadata?.numora_user_id
  if (metadataUserId && metadataUserId !== billingCustomer.userId) {
    throw new Error(
      `[invoice-sync] Inconsistência: invoice.metadata.numora_user_id (${metadataUserId}) diverge do user_id resolvido via billing_customers (${billingCustomer.userId}) para o Stripe Customer ${stripeCustomerId}.`,
    )
  }

  const stripeSubscriptionId = extractStripeSubscriptionId(invoice)
  const subscriptionId = await resolveLocalSubscriptionId(supabase, stripeSubscriptionId)

  const stripePaymentIntentId = extractStripePaymentIntentId(invoice)

  const currency = normalizeCurrency(invoice.currency)
  const amount = fromStripeMinorUnits(amountMinorUnits)
  const paidAt = paidAtUnix !== null ? new Date(paidAtUnix * 1000).toISOString() : null

  const { data, error } = await supabase
    .rpc('sync_billing_transaction_from_invoice', {
      p_user_id: billingCustomer.userId,
      p_subscription_id: subscriptionId,
      p_stripe_invoice_id: invoice.id,
      p_stripe_payment_intent_id: stripePaymentIntentId,
      p_amount: amount,
      p_currency: currency,
      p_status: status,
      p_paid_at: paidAt,
    })
    .single()

  if (error) {
    throw new Error(`[invoice-sync] Falha ao sincronizar a transação do invoice ${invoice.id}: ${error.message}`)
  }

  const row = data as SyncBillingTransactionRpcRow
  return { outcome: 'synced', transactionId: row.transaction_id, previousStatus: row.previous_status, newStatus: row.new_status }
}

/**
 * `invoice.paid`: usa `amount_paid` (o que realmente foi cobrado) e
 * `status_transitions.paid_at` (quando o Stripe realmente marcou como
 * pago) — nunca `new Date()` do servidor, nunca um timestamp inventado.
 */
export async function syncInvoicePaid(supabase: SupabaseClient, stripe: Stripe, stripeInvoiceId: string): Promise<SyncInvoiceResult> {
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ['payments'] })
  return syncInvoiceTransaction(supabase, invoice, 'paid', invoice.amount_paid, invoice.status_transitions?.paid_at ?? null)
}

/**
 * `invoice.payment_failed`: usa `amount_due` (o que foi tentado cobrar —
 * `amount_paid` seria 0 numa falha, o que esconderia o valor real da
 * tentativa). `paid_at` é sempre `null` (FASE 9) — nunca alteramos
 * `subscriptions.status` aqui, isso continua 100% a cargo do Subscription
 * Sync/estado canônico do Stripe.
 */
export async function syncInvoicePaymentFailed(supabase: SupabaseClient, stripe: Stripe, stripeInvoiceId: string): Promise<SyncInvoiceResult> {
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ['payments'] })
  return syncInvoiceTransaction(supabase, invoice, 'failed', invoice.amount_due, null)
}
