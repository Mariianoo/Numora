/**
 * lib/stripe/analytics-outbox.ts
 * Etapa "5.9G — First-Party Analytics Outbox" — resolve QUANDO um evento
 * Stripe deveria gerar `checkout_completed` (função pura, sem I/O — mesmo
 * padrão de `decideWebhookAction`/`dispatchWebhookEvent`, lib/stripe/webhook.ts)
 * e persiste o resultado em `public.analytics_outbox` (I/O, thin wrapper —
 * mesmo padrão de `recordWebhookEvent`).
 *
 * NENHUM vendor externo é chamado a partir daqui (Etapa 5.9F/5.9G:
 * decisão de vendor explicitamente adiada). Esta função só grava uma linha
 * local — a entrega a um vendor futuro é responsabilidade de um forwarder
 * desacoplado que ainda não existe.
 *
 * EVENTO CANÔNICO (Etapa "5.9F Decision Audit" §CANONICAL DEFINITION,
 * confirmado por auditoria real do Stripe TEST nesta etapa: CARD=on,
 * BOLETO=off, PIX=off, nenhum método assíncrono habilitado): só
 * `checkout.session.completed` com `payment_status === 'paid'` gera
 * `checkout_completed`. `checkout.session.async_payment_succeeded`/
 * `_failed` NÃO são tratados aqui — se um método de pagamento assíncrono
 * for habilitado no futuro, uma etapa específica precisará adicioná-los
 * (e a `RECOGNIZED_WEBHOOK_EVENT_TYPES` em lib/stripe/webhook.ts).
 *
 * `customer.subscription.created/updated/deleted` e `invoice.paid` NUNCA
 * geram `checkout_completed` (mesmo reconhecidos e sincronizados
 * normalmente para billing por subscription-sync.ts/invoice-sync.ts) —
 * são eventos RECORRENTES (toda renovação gera um novo `invoice.paid`),
 * enquanto uma Checkout Session é de uso único; usá-los como fonte
 * duplicaria o funil a cada ciclo de cobrança.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

const UNIQUE_VIOLATION = '23505'

export interface CheckoutCompletedOutboxInput {
  funnelId: string
  triggerValue: string | null
  planSlug: string | null
  interval: string | null
  currency: string | null
  consentSnapshot: boolean
  /** Stripe Checkout Session ID — só para idempotência/correlação interna, nunca sai deste módulo. */
  sourceReference: string
}

/**
 * Pura — nunca toca o banco/Stripe de novo (só lê o payload do evento já
 * verificado). `null` = este evento não deve gerar `checkout_completed`:
 * não é o tipo canônico, o pagamento ainda não foi confirmado, ou falta
 * `funnel_id` (Session criada antes desta etapa, ou algum fluxo que não
 * passou por `createCheckoutSession` — nunca inventamos um funnel_id
 * aqui, silenciosamente pular é mais seguro que gravar uma linha sem o
 * único identificador que ela existe para carregar).
 */
export function resolveCheckoutCompletedOutboxInput(event: Stripe.Event): CheckoutCompletedOutboxInput | null {
  if (event.type !== 'checkout.session.completed') return null

  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') return null

  const funnelId = session.metadata?.numora_funnel_id
  if (!funnelId) return null

  // Fail-closed (Etapa 5.9G §CONSENT NO WEBHOOK): só a string literal
  // 'true' vira `true` — ausente, `'false'`, ou qualquer outro valor
  // inesperado em metadata vira `false`. Nunca inferido, nunca assumido.
  const consentSnapshot = session.metadata?.numora_analytics_consent === 'true'

  return {
    funnelId,
    triggerValue: session.metadata?.numora_trigger ?? null,
    planSlug: session.metadata?.numora_plan_slug ?? null,
    interval: session.metadata?.numora_interval ?? null,
    currency: session.metadata?.numora_currency ?? null,
    consentSnapshot,
    sourceReference: session.id,
  }
}

export type RecordCheckoutCompletedOutcome = 'inserted' | 'duplicate'

/**
 * Idempotência via `uq_analytics_outbox_source_reference_event_name` (o
 * banco é a autoridade, nunca memória do processo) — mesmo padrão de
 * `recordWebhookEvent`. `outcome: 'duplicate'` nunca é tratado como erro
 * pelo chamador: representa exatamente "mesmo Checkout Session, mesmo
 * evento — já registrado", o resultado correto sob reprocessamento do
 * mesmo webhook Stripe.
 */
export async function recordCheckoutCompletedOutboxEvent(
  supabase: SupabaseClient,
  input: CheckoutCompletedOutboxInput,
): Promise<RecordCheckoutCompletedOutcome> {
  const { error } = await supabase.from('analytics_outbox').insert({
    funnel_id: input.funnelId,
    event_name: 'checkout_completed',
    trigger: input.triggerValue,
    plan_slug: input.planSlug,
    interval: input.interval,
    currency: input.currency,
    consent_snapshot: input.consentSnapshot,
    source_reference: input.sourceReference,
  })

  if (!error) return 'inserted'
  if (error.code === UNIQUE_VIOLATION) return 'duplicate'

  throw new Error(`[analytics-outbox] Falha ao registrar checkout_completed (source_reference=${input.sourceReference}): ${error.message}`)
}
