/**
 * tests/integration/analytics-outbox.test.ts
 * Etapa "5.9G — First-Party Analytics Outbox" — prova, contra Supabase DEV
 * real, que:
 *
 * 1) `UNIQUE(source_reference, event_name)` realmente impede uma segunda
 *    linha `checkout_completed` para o MESMO Checkout Session (idempotência
 *    de verdade, não só a de `billing_webhook_events` — ver comentário da
 *    migration/lib/stripe/analytics-outbox.ts sobre por que as duas são
 *    necessárias);
 * 2) o pipeline completo do webhook (assinatura real via
 *    `stripe.webhooks.generateTestHeaderString`, mesmo padrão de
 *    tests/integration/stripe-webhook-foundation.test.ts) escreve
 *    exatamente 1 linha para um `checkout.session.completed` pago, e ZERO
 *    linhas para `invoice.paid`/`customer.subscription.created` isolados;
 * 3) RLS nunca permite a um usuário autenticado inserir/ler/alterar
 *    `analytics_outbox` — nem mesmo a própria linha (não é dado do
 *    usuário, é telemetria interna).
 *
 * ZERO chamada a vendor externo em qualquer teste deste arquivo — não há
 * nenhum `fetch`/SDK de analytics importado aqui, de propósito.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { recordCheckoutCompletedOutboxEvent, resolveCheckoutCompletedOutboxInput } from '@/lib/stripe/analytics-outbox'
import { decideWebhookAction, dispatchWebhookEvent, markWebhookEventProcessed, recordWebhookEvent, verifyStripeWebhookEvent } from '@/lib/stripe/webhook'
import { syncFromRecognizedWebhookEvent } from '@/lib/stripe/subscription-sync'
import { createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, signInAsDisposableUser, type TestEnv } from '../support/dev-env'

const SYNTHETIC_WEBHOOK_SECRET = `whsec_test_only_5_9g_${'f'.repeat(20)}` // nunca real, só nesta execução do arquivo

function makeCheckoutSessionCompletedPayload(overrides: { id?: string; sessionId?: string; paymentStatus?: string; metadata?: Record<string, string> } = {}) {
  return {
    id: overrides.id ?? `evt_test_${crypto.randomUUID()}`,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: overrides.sessionId ?? `cs_test_5_9g_${crypto.randomUUID()}`,
        object: 'checkout.session',
        payment_status: overrides.paymentStatus ?? 'paid',
        metadata: overrides.metadata ?? {},
        // Sem `subscription` de propósito — força syncFromRecognizedWebhookEvent
        // a resolver 'skipped' (comportamento já legítimo/testado desde a
        // Stripe 5.4B), provando que o outbox nunca depende de billing
        // sync ter encontrado uma subscription para sincronizar.
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  }
}

function makeOtherEventPayload(type: string) {
  return {
    id: `evt_test_${crypto.randomUUID()}`,
    object: 'event',
    type,
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: `obj_test_5_9g_${crypto.randomUUID()}` } },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  }
}

describe.skipIf(!hasTestEnv())('analytics_outbox (DEV real) — Etapa 5.9G', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  const insertedWebhookEventIds = new Set<string>()
  const insertedSourceReferences = new Set<string>()

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()
  })

  afterEach(async () => {
    if (insertedWebhookEventIds.size > 0) {
      await admin.from('billing_webhook_events').delete().in('stripe_event_id', Array.from(insertedWebhookEventIds))
      insertedWebhookEventIds.clear()
    }
    if (insertedSourceReferences.size > 0) {
      await admin.from('analytics_outbox').delete().in('source_reference', Array.from(insertedSourceReferences))
      insertedSourceReferences.clear()
    }
  })

  describe('Idempotência real (item 18/K/L) — UNIQUE(source_reference, event_name)', () => {
    it('2ª tentativa de gravar o MESMO Checkout Session → "duplicate", nunca uma 2ª linha', async () => {
      const sourceReference = `cs_test_5_9g_dedup_${crypto.randomUUID()}`
      insertedSourceReferences.add(sourceReference)
      const input = {
        funnelId: crypto.randomUUID(),
        triggerValue: null,
        planSlug: 'pro',
        interval: 'month',
        currency: 'BRL',
        consentSnapshot: true,
        sourceReference,
      }

      const first = await recordCheckoutCompletedOutboxEvent(admin, input)
      const second = await recordCheckoutCompletedOutboxEvent(admin, input)

      expect(first).toBe('inserted')
      expect(second).toBe('duplicate')

      const { data: rows } = await admin.from('analytics_outbox').select('id').eq('source_reference', sourceReference)
      expect(rows).toHaveLength(1)
    })

    it('grava com os valores corretos (status inicial pending, attempts=0, processed_at nulo — nenhum forwarder existe ainda)', async () => {
      const sourceReference = `cs_test_5_9g_values_${crypto.randomUUID()}`
      insertedSourceReferences.add(sourceReference)
      const funnelId = crypto.randomUUID()

      await recordCheckoutCompletedOutboxEvent(admin, {
        funnelId,
        triggerValue: 'collection_limit',
        planSlug: 'pro',
        interval: 'month',
        currency: 'BRL',
        consentSnapshot: false,
        sourceReference,
      })

      const { data: row } = await admin
        .from('analytics_outbox')
        .select('funnel_id, event_name, trigger, plan_slug, interval, currency, consent_snapshot, status, attempts, processed_at')
        .eq('source_reference', sourceReference)
        .single()

      expect(row).toMatchObject({
        funnel_id: funnelId,
        event_name: 'checkout_completed',
        trigger: 'collection_limit',
        plan_slug: 'pro',
        interval: 'month',
        currency: 'BRL',
        consent_snapshot: false,
        status: 'pending',
        attempts: 0,
        processed_at: null,
      })
    })
  })

  describe('Pipeline completo do webhook (assinatura real + persistência real)', () => {
    it('checkout.session.completed pago (assinatura válida) → exatamente 1 linha em analytics_outbox, mesmo com billing sync "skipped" (sem subscription anexada)', async () => {
      const funnelId = crypto.randomUUID()
      const eventPayload = makeCheckoutSessionCompletedPayload({
        metadata: { numora_funnel_id: funnelId, numora_analytics_consent: 'true', numora_plan_slug: 'pro', numora_interval: 'month', numora_currency: 'BRL' },
      })
      insertedWebhookEventIds.add(eventPayload.id)
      insertedSourceReferences.add(eventPayload.data.object.id)

      const payloadString = JSON.stringify(eventPayload)
      const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: SYNTHETIC_WEBHOOK_SECRET })
      const verifiedEvent = verifyStripeWebhookEvent(stripe, payloadString, signatureHeader, SYNTHETIC_WEBHOOK_SECRET)

      const record = await recordWebhookEvent(admin, verifiedEvent)
      expect(decideWebhookAction(record)).toBe('process')

      const dispatch = dispatchWebhookEvent(verifiedEvent)
      expect(dispatch.recognized).toBe(true)

      // Mesma sequência de app/api/stripe/webhook/route.ts.
      const syncResult = await syncFromRecognizedWebhookEvent(admin, stripe, verifiedEvent)
      expect(syncResult.outcome).toBe('skipped') // sem session.subscription — comportamento já legítimo desde a Stripe 5.4B

      const outboxInput = resolveCheckoutCompletedOutboxInput(verifiedEvent)
      expect(outboxInput).not.toBeNull()
      const outcome = await recordCheckoutCompletedOutboxEvent(admin, outboxInput!)
      expect(outcome).toBe('inserted')

      await markWebhookEventProcessed(admin, record.id)

      const { data: webhookRow } = await admin.from('billing_webhook_events').select('status').eq('stripe_event_id', eventPayload.id).single()
      expect(webhookRow?.status).toBe('processed') // billing continua funcionando normalmente (item G)

      const { data: outboxRows } = await admin.from('analytics_outbox').select('id, funnel_id, consent_snapshot').eq('source_reference', eventPayload.data.object.id)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows![0].funnel_id).toBe(funnelId)
      expect(outboxRows![0].consent_snapshot).toBe(true)
    })

    it('reprocessar o MESMO evento (retry do Stripe) → billing_webhook_events idempotente E analytics_outbox nunca duplica', async () => {
      const eventPayload = makeCheckoutSessionCompletedPayload({ metadata: { numora_funnel_id: crypto.randomUUID(), numora_analytics_consent: 'true' } })
      insertedWebhookEventIds.add(eventPayload.id)
      insertedSourceReferences.add(eventPayload.data.object.id)

      const payloadString = JSON.stringify(eventPayload)
      const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: SYNTHETIC_WEBHOOK_SECRET })
      const verifiedEvent = verifyStripeWebhookEvent(stripe, payloadString, signatureHeader, SYNTHETIC_WEBHOOK_SECRET)

      async function processOnce() {
        const record = await recordWebhookEvent(admin, verifiedEvent)
        const action = decideWebhookAction(record)
        if (action === 'process') {
          await syncFromRecognizedWebhookEvent(admin, stripe, verifiedEvent)
          const outboxInput = resolveCheckoutCompletedOutboxInput(verifiedEvent)
          if (outboxInput) await recordCheckoutCompletedOutboxEvent(admin, outboxInput)
          await markWebhookEventProcessed(admin, record.id)
        }
        return action
      }

      const firstAction = await processOnce()
      const secondAction = await processOnce() // Stripe reenviando o mesmo evento

      expect(firstAction).toBe('process')
      expect(secondAction).toBe('skip_processed') // billing_webhook_events já garante isto sozinho

      const { data: rows } = await admin.from('analytics_outbox').select('id').eq('source_reference', eventPayload.data.object.id)
      expect(rows).toHaveLength(1) // nunca duplicou
    })

    it.each(['customer.subscription.created', 'invoice.paid'])(
      'evento %s isolado (reconhecido, sincronizado normalmente) NUNCA gera linha em analytics_outbox (itens K/L)',
      async (type) => {
        const eventPayload = makeOtherEventPayload(type)
        insertedWebhookEventIds.add(eventPayload.id)

        const payloadString = JSON.stringify(eventPayload)
        const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: SYNTHETIC_WEBHOOK_SECRET })
        const verifiedEvent = verifyStripeWebhookEvent(stripe, payloadString, signatureHeader, SYNTHETIC_WEBHOOK_SECRET)

        const record = await recordWebhookEvent(admin, verifiedEvent)
        expect(decideWebhookAction(record)).toBe('process')

        const dispatch = dispatchWebhookEvent(verifiedEvent)
        expect(dispatch.recognized).toBe(true)

        // Não chamamos syncFromRecognizedWebhookEvent aqui de propósito:
        // customer/subscription fabricados não existem de verdade no
        // Stripe e o sync lançaria — irrelevante para este teste, que só
        // prova que resolveCheckoutCompletedOutboxInput (o gate real usado
        // pelo webhook route antes de sequer chamar recordCheckoutCompletedOutboxEvent)
        // nunca reconhece este tipo de evento como fonte de checkout_completed.
        const outboxInput = resolveCheckoutCompletedOutboxInput(verifiedEvent)
        expect(outboxInput).toBeNull()

        await markWebhookEventProcessed(admin, record.id)
      },
    )
  })

  describe('RLS/Security (item 13/19) — checkout_completed nunca pode nascer do browser', () => {
    it('usuário autenticado comum não lê, insere, nem altera analytics_outbox', async () => {
      const user = await createDisposableUser(admin, 'analytics-outbox-rls')
      try {
        const userClient = await signInAsDisposableUser(env, user)

        const { data: selectData, error: selectError } = await userClient.from('analytics_outbox').select('id').limit(1)
        expect(selectError).not.toBeNull()
        expect(selectData).toBeNull()

        const { error: insertError } = await userClient.from('analytics_outbox').insert({
          funnel_id: crypto.randomUUID(),
          event_name: 'checkout_completed',
          consent_snapshot: true,
          source_reference: `cs_should_not_work_${Date.now()}`,
        })
        expect(insertError).not.toBeNull()

        const { error: updateError } = await userClient.from('analytics_outbox').update({ status: 'delivered' }).eq('event_name', 'checkout_completed')
        expect(updateError).not.toBeNull()
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })
  })

  it('nenhum resíduo desta suíte permanece em analytics_outbox (tabela nova, só este arquivo escreve nela)', async () => {
    const { count } = await admin.from('analytics_outbox').select('id', { count: 'exact', head: true })
    expect(count ?? 0).toBe(0)
  })
})
