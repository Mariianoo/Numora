/**
 * app/api/stripe/webhook/route.ts
 * Etapa "Stripe 5.4A — Webhook Foundation" — recebe eventos do Stripe,
 * verifica a assinatura e registra de forma idempotente.
 * Etapa "Stripe 5.4B — Subscription Sync" — passou a chamar
 * `syncFromRecognizedWebhookEvent` (lib/stripe/subscription-sync.ts) para
 * eventos reconhecidos: sincroniza `public.subscriptions` a partir do
 * estado CANÔNICO da subscription no Stripe. NÃO escreve
 * entitlement/benefit_grants — `effective_plans()` continua intocada.
 *
 * Etapa "5.10Q-A — Live Billing Guards" — reordenado (5.10O §8) para
 * determinar o ambiente/modo ANTES de tocar no corpo da requisição, e
 * para validar `event.livemode` como uma SEGUNDA camada independente da
 * assinatura (nunca uma substituição dela):
 *   1. `assertBillingEnvironment` — determina se este ambiente pode
 *      operar billing, e em qual modo (test/live).
 *   2. `stripe-signature` precisa estar presente.
 *   3. Resolve o secret ESPERADO para o modo já validado (nunca aceita
 *      "qualquer secret que funcione" — 5.10O §7/§11).
 *   4. Lê o raw body.
 *   5. Verifica a assinatura (inalterado — `verifyStripeWebhookEvent`).
 *   6. Valida `event.livemode` contra o modo esperado (gap do 5.10O §9,
 *      fechado aqui) — um evento TEST nunca é aceito quando o ambiente
 *      espera LIVE, e vice-versa, mesmo que a assinatura tenha batido.
 *   7. Idempotência → 8. dispatch → 9. sync → 10. resposta (inalterados).
 *
 * SEM SESSÃO: este endpoint nunca chama `getSupabaseServerClient().auth.getUser()`
 * — quem chama é o Stripe, não um usuário logado. `user_id`/`numora_user_id`
 * só aparecem dentro do PAYLOAD do evento (ex.: `metadata.numora_user_id`
 * de uma Checkout Session, Stripe 5.3) — nunca são confiados sem a
 * assinatura já ter sido validada primeiro.
 *
 * RAW BODY: a assinatura é verificada sobre o texto EXATO do corpo
 * (`request.text()`), nunca sobre um JSON re-parseado/re-serializado —
 * `stripe.webhooks.constructEvent` faz o parsing internamente DEPOIS de
 * confirmar a assinatura.
 *
 * `billing_webhook_events` não tem NENHUMA policy de RLS (auditado nesta
 * etapa) — toda escrita usa `service_role`, nunca exposto ao cliente.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertBillingEnvironment, gatherBillingEnvironmentContext } from '@/lib/billing/assert-billing-environment'
import { getExpectedStripeWebhookSecret } from '@/lib/env.stripe.server'
import { getStripeClient } from '@/lib/stripe/client'
import { assertWebhookLivemodeMatchesExpectedMode, type ExpectedStripeMode } from '@/lib/stripe/webhook-mode'
import { decideWebhookAction, markWebhookEventFailed, markWebhookEventProcessed, recordWebhookEvent, verifyStripeWebhookEvent } from '@/lib/stripe/webhook'
import { dispatchWebhookEvent, syncFromRecognizedWebhookEvent } from '@/lib/stripe/subscription-sync'
import { recordCheckoutCompletedOutboxEvent, resolveCheckoutCompletedOutboxInput } from '@/lib/stripe/analytics-outbox'

export async function POST(request: Request) {
  let expectedMode: ExpectedStripeMode
  try {
    const context = gatherBillingEnvironmentContext()
    assertBillingEnvironment(context)
    // `assertBillingEnvironment` já rejeitou 'invalid' acima — garantidamente 'test'|'live' aqui.
    expectedMode = context.stripeKeyMode as ExpectedStripeMode
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Operação indisponível neste ambiente.' }, { status: 500 })
  }

  const signatureHeader = request.headers.get('stripe-signature')
  if (!signatureHeader) {
    return NextResponse.json({ error: 'Cabeçalho stripe-signature ausente.' }, { status: 400 })
  }

  let stripe
  let webhookSecret: string
  try {
    stripe = getStripeClient()
    webhookSecret = getExpectedStripeWebhookSecret(expectedMode)
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Configuração do Stripe indisponível.' }, { status: 500 })
  }

  const rawBody = await request.text()

  let event
  try {
    event = verifyStripeWebhookEvent(stripe, rawBody, signatureHeader, webhookSecret)
  } catch {
    // Nunca logamos o erro bruto do SDK aqui: ele já não contém o segredo,
    // mas não há necessidade de reportar tentativas de assinatura inválida
    // como exceção de aplicação — é o comportamento esperado para tráfego
    // não autenticado (scanners, replays adulterados, configuração errada
    // de outro ambiente apontando para esta URL).
    return NextResponse.json({ error: 'Assinatura ou payload inválidos.' }, { status: 400 })
  }

  try {
    assertWebhookLivemodeMatchesExpectedMode(event, expectedMode)
  } catch {
    // Mesmo tratamento da assinatura inválida: nunca revela detalhes, nunca
    // vira exceção de aplicação — é uma segunda camada de autenticação
    // (5.10O §8/§9), não um erro de infraestrutura.
    Sentry.captureMessage(`[stripe-webhook] evento ${event.id} rejeitado: event.livemode não corresponde ao modo esperado ("${expectedMode}").`, 'warning')
    return NextResponse.json({ error: 'Assinatura ou payload inválidos.' }, { status: 400 })
  }

  const adminClient = getSupabaseAdminClient()

  let record
  try {
    record = await recordWebhookEvent(adminClient, event)
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Falha ao registrar o evento.' }, { status: 500 })
  }

  const action = decideWebhookAction(record)

  if (action === 'skip_processed') {
    return NextResponse.json({ received: true, status: 'duplicate_processed' })
  }

  if (action === 'skip_in_progress') {
    return NextResponse.json({ received: true, status: 'duplicate_in_progress' })
  }

  // action === 'process' — evento novo OU retry de um evento que tinha falhado antes.
  try {
    const dispatch = dispatchWebhookEvent(event)
    if (dispatch.recognized) {
      // Stripe 5.4B: sincroniza public.subscriptions a partir do estado
      // canônico do Stripe. invoice.*/tipos não tratados aqui são no-op
      // (fora de escopo desta etapa) — ver syncFromRecognizedWebhookEvent.
      const syncResult = await syncFromRecognizedWebhookEvent(adminClient, stripe, event)
      if (syncResult.outcome === 'skipped') {
        Sentry.captureMessage(`[stripe-webhook] evento ${event.id} (${event.type}) reconhecido mas sem subscription para sincronizar: ${syncResult.reason}`, 'info')
      }

      // Etapa "5.9G — First-Party Analytics Outbox" — SEMPRE depois do
      // billing sync ter sucesso (nunca antes, nunca em paralelo) e SEMPRE
      // best-effort: uma falha aqui nunca deve derrubar o webhook, desfazer
      // o billing sync, ou impedir markWebhookEventProcessed abaixo. Nenhum
      // vendor externo é chamado — só grava localmente em analytics_outbox.
      try {
        const outboxInput = resolveCheckoutCompletedOutboxInput(event)
        if (outboxInput) {
          await recordCheckoutCompletedOutboxEvent(adminClient, outboxInput)
        }
      } catch (analyticsErr) {
        Sentry.captureException(analyticsErr)
      }
    }
    await markWebhookEventProcessed(adminClient, record.id)
  } catch (err) {
    Sentry.captureException(err)
    try {
      await markWebhookEventFailed(adminClient, record.id, err instanceof Error ? err.message : 'Erro desconhecido ao processar o evento.')
    } catch (markErr) {
      Sentry.captureException(markErr)
    }
    // 500 permite que o Stripe reenvie o mesmo evento mais tarde (retry automático).
    return NextResponse.json({ error: 'Falha ao processar o evento.' }, { status: 500 })
  }

  return NextResponse.json({ received: true, status: 'processed' })
}
