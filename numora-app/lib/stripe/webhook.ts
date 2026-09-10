/**
 * lib/stripe/webhook.ts
 * Etapa "Stripe 5.4A — Webhook Foundation" — verificação de assinatura,
 * persistência idempotente e dispatcher (sem lógica de negócio ainda) para
 * eventos do Stripe.
 *
 * NADA aqui cria/atualiza `subscriptions`, `billing_customers` ou
 * entitlements — o dispatcher só RECONHECE o tipo do evento (para a Stripe
 * 5.4B não precisar mexer nesta camada de novo). `billing_webhook_events`
 * não tem NENHUMA policy de RLS (auditado nesta etapa: `relrowsecurity =
 * true`, zero linhas em `pg_policies`) — toda escrita aqui exige
 * `service_role`, nunca o client de sessão de um usuário (que aliás nem
 * existe: quem chama este endpoint é o Stripe, não um usuário logado).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

const UNIQUE_VIOLATION = '23505'

export type WebhookEventStatus = 'received' | 'processed' | 'failed'

/**
 * Verificação de assinatura — wrapper fino sobre o SDK oficial
 * (`stripe.webhooks.constructEvent`). Único ponto de confiança: se a
 * assinatura não bater com o RAW BODY exato, lança (nunca um fallback que
 * aceite o payload sem assinatura válida). O `rawBody` precisa ser o texto
 * ORIGINAL da requisição — nunca um JSON re-serializado (re-serializar
 * pode mudar espaçamento/ordem de chaves e invalidar a assinatura mesmo
 * para um payload legítimo).
 */
export function verifyStripeWebhookEvent(stripe: Stripe, rawBody: string, signatureHeader: string, webhookSecret: string): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)
}

export interface RecordWebhookEventResult {
  outcome: 'new' | 'duplicate'
  id: string
  status: WebhookEventStatus
}

/**
 * Idempotência via `uq_billing_webhook_events_stripe_event_id` (o banco é
 * a autoridade, nunca memória do processo Node) — tenta inserir; se outra
 * entrega do MESMO `event.id` já venceu a corrida (`23505`), relê a linha
 * existente e devolve `outcome: 'duplicate'` com o status ATUAL dela
 * (`received`/`processed`/`failed`) para o chamador decidir o que fazer
 * (`decideWebhookAction`).
 */
export async function recordWebhookEvent(supabase: SupabaseClient, event: Stripe.Event): Promise<RecordWebhookEventResult> {
  const { data, error } = await supabase
    .from('billing_webhook_events')
    .insert({ stripe_event_id: event.id, type: event.type, payload: event, status: 'received' })
    .select('id, status')
    .single()

  if (!error) {
    return { outcome: 'new', id: data!.id as string, status: data!.status as WebhookEventStatus }
  }

  if (error.code === UNIQUE_VIOLATION) {
    const { data: existing, error: readError } = await supabase
      .from('billing_webhook_events')
      .select('id, status')
      .eq('stripe_event_id', event.id)
      .single()

    if (readError || !existing) {
      throw new Error(`[recordWebhookEvent] Conflito de unicidade para stripe_event_id ${event.id}, mas a releitura falhou: ${readError?.message}`)
    }

    return { outcome: 'duplicate', id: existing.id as string, status: existing.status as WebhookEventStatus }
  }

  throw new Error(`[recordWebhookEvent] Falha ao registrar evento ${event.id}: ${error.message}`)
}

export async function markWebhookEventProcessed(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('billing_webhook_events')
    .update({ status: 'processed', processed_at: new Date().toISOString(), error: null })
    .eq('id', id)

  if (error) {
    throw new Error(`[markWebhookEventProcessed] Falha ao marcar evento ${id} como processed: ${error.message}`)
  }
}

/** `errorMessage` nunca deve conter segredos — só uma descrição do que falhou (o chamador é responsável por não incluir dados sensíveis). */
export async function markWebhookEventFailed(supabase: SupabaseClient, id: string, errorMessage: string): Promise<void> {
  const { error } = await supabase.from('billing_webhook_events').update({ status: 'failed', error: errorMessage }).eq('id', id)

  if (error) {
    throw new Error(`[markWebhookEventFailed] Falha ao marcar evento ${id} como failed: ${error.message}`)
  }
}

export type WebhookAction = 'process' | 'skip_processed' | 'skip_in_progress'

/**
 * Semântica de replay/retry/concorrência (Stripe 5.4A FASE 7/8/10/11),
 * isolada nesta função PURA para ser exaustivamente testável:
 *   - evento novo (`outcome: 'new'`) → sempre processar.
 *   - duplicado, já `processed` → NUNCA reprocessar (replay seguro).
 *   - duplicado, `failed` → processar de novo (retry legítimo do Stripe).
 *   - duplicado, ainda `received` → outra entrega concorrente está em voo
 *     agora mesmo; esta aqui só reconhece (idempotente), nunca processa em
 *     paralelo com a primeira.
 */
export function decideWebhookAction(record: RecordWebhookEventResult): WebhookAction {
  if (record.outcome === 'new') {
    return 'process'
  }

  if (record.status === 'processed') {
    return 'skip_processed'
  }

  if (record.status === 'failed') {
    return 'process'
  }

  return 'skip_in_progress'
}

/**
 * Eventos que a Stripe 5.4B vai implementar de verdade. Nesta etapa
 * (5.4A) só são RECONHECIDOS — nenhuma lógica de negócio, nenhuma
 * subscription/entitlement é tocada. `dispatchWebhookEvent` nem recebe um
 * client Supabase: estruturalmente não tem como escrever em nada.
 *
 * Etapa "5.9G — First-Party Analytics Outbox": `checkout.session.completed`
 * também alimenta `checkout_completed` (lib/stripe/analytics-outbox.ts),
 * só quando `payment_status === 'paid'` — correto hoje porque o Stripe
 * TEST desta conta tem só `card` habilitado (Boleto/PIX confirmados OFF
 * via auditoria real da API nesta etapa, nenhum método assíncrono). SE um
 * método assíncrono for habilitado no futuro (Boleto/PIX/outro), Sessions
 * podem completar com `payment_status !== 'paid'` e o pagamento real só
 * se confirma depois via `checkout.session.async_payment_succeeded`
 * (ou falha via `async_payment_failed`) — NENHUM dos dois está nesta
 * lista, e uma etapa específica precisará: (1) adicioná-los aqui, (2)
 * ensinar `dispatchWebhookEvent`/`syncFromRecognizedWebhookEvent` a
 * reconhecê-los, e (3) estender `resolveCheckoutCompletedOutboxInput` para
 * também aceitar `async_payment_succeeded` como fonte canônica. Não
 * implementado agora porque não há método assíncrono habilitado para
 * testar contra o Stripe TEST real.
 */
export const RECOGNIZED_WEBHOOK_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const

export interface DispatchResult {
  recognized: boolean
}

/**
 * Nunca lança para um tipo desconhecido — Stripe pode enviar tipos que o
 * Numora ainda não usa; registrar e seguir em frente é o comportamento
 * correto (nunca descartar silenciosamente, nunca quebrar o endpoint).
 */
export function dispatchWebhookEvent(event: Stripe.Event): DispatchResult {
  const recognized = (RECOGNIZED_WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.type)
  return { recognized }
}
