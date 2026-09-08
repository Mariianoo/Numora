/**
 * tests/integration/stripe-webhook-foundation.test.ts
 * Etapa "Stripe 5.4A — Webhook Foundation" — prova, contra Supabase DEV
 * real, a persistência idempotente de `billing_webhook_events`
 * (novo/duplicado/concorrência/failed/replay/desconhecido) e que a RLS da
 * tabela não foi enfraquecida. Um teste adicional exercita o pipeline
 * COMPLETO (assinatura real via `getStripeClient()` + persistência real)
 * usando um `STRIPE_WEBHOOK_SECRET` sintético gerado só para este arquivo
 * (nunca lido de `.env.local` — hoje ausente, auditado na Fase 1 desta
 * etapa — e nunca persistido em lugar nenhum).
 *
 * Eventos são sempre PAYLOADS SINTÉTICOS (fabricados aqui, nunca vindos de
 * uma chamada real ao Stripe) — mas a ASSINATURA sobre eles é sempre
 * gerada pelo mecanismo oficial do SDK (`stripe.webhooks.generateTestHeaderString`),
 * nunca uma falsificação manual.
 *
 * ZERO subscription/billing_customer é criado ou tocado — o dispatcher
 * desta etapa não recebe nenhum client de escrita (ver lib/stripe/webhook.ts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import {
  decideWebhookAction,
  dispatchWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
  verifyStripeWebhookEvent,
} from '@/lib/stripe/webhook'
import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  signInAsDisposableUser,
  type TestEnv,
} from '../support/dev-env'

const SYNTHETIC_WEBHOOK_SECRET = `whsec_test_only_${'d'.repeat(24)}` // nunca real, nunca persistido, só nesta execução do arquivo

function makeSyntheticEventPayload(overrides: Partial<{ id: string; type: string }> = {}) {
  return {
    id: overrides.id ?? `evt_test_${crypto.randomUUID()}`,
    object: 'event',
    type: overrides.type ?? 'checkout.session.completed',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cs_test_synthetic' } },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  }
}

describe.skipIf(!hasTestEnv())('billing_webhook_events (DEV real) — Stripe 5.4A', () => {
  let env: TestEnv
  let admin: SupabaseClient
  const insertedEventIds = new Set<string>()

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
  })

  afterEach(async () => {
    if (insertedEventIds.size > 0) {
      await admin.from('billing_webhook_events').delete().in('stripe_event_id', Array.from(insertedEventIds))
      insertedEventIds.clear()
    }
  })

  function trackedEvent(overrides: Partial<{ id: string; type: string }> = {}) {
    const event = makeSyntheticEventPayload(overrides)
    insertedEventIds.add(event.id)
    return event as unknown as Stripe.Event
  }

  it('A) evento novo: 1 linha criada, status inicial "received"', async () => {
    const event = trackedEvent()
    const result = await recordWebhookEvent(admin, event)
    expect(result.outcome).toBe('new')
    expect(result.status).toBe('received')

    const { data: rows } = await admin.from('billing_webhook_events').select('id, stripe_event_id, type, status').eq('stripe_event_id', event.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].type).toBe(event.type)
  })

  it('evento novo → dispatcher reconhece → marca "processed"', async () => {
    const event = trackedEvent({ type: 'customer.subscription.created' })
    const result = await recordWebhookEvent(admin, event)
    expect(decideWebhookAction(result)).toBe('process')

    const dispatch = dispatchWebhookEvent(event)
    expect(dispatch.recognized).toBe(true)
    await markWebhookEventProcessed(admin, result.id)

    const { data: row } = await admin.from('billing_webhook_events').select('status, processed_at').eq('stripe_event_id', event.id).single()
    expect(row?.status).toBe('processed')
    expect(row?.processed_at).not.toBeNull()
  })

  it('B) mesmo evento duas vezes (sequencial): continua existindo só 1 registro', async () => {
    const event = trackedEvent()
    const first = await recordWebhookEvent(admin, event)
    const second = await recordWebhookEvent(admin, event)

    expect(first.outcome).toBe('new')
    expect(second.outcome).toBe('duplicate')
    expect(second.id).toBe(first.id)

    const { data: rows } = await admin.from('billing_webhook_events').select('id').eq('stripe_event_id', event.id)
    expect(rows).toHaveLength(1)
  })

  it('C) duas requisições SIMULTÂNEAS do mesmo evento: exatamente 1 registro, uma "new" e uma "duplicate"', async () => {
    const event = trackedEvent()
    const [resultA, resultB] = await Promise.all([recordWebhookEvent(admin, event), recordWebhookEvent(admin, event)])

    const outcomes = [resultA.outcome, resultB.outcome].sort()
    expect(outcomes).toEqual(['duplicate', 'new'])
    expect(resultA.id).toBe(resultB.id)

    const { data: rows } = await admin.from('billing_webhook_events').select('id').eq('stripe_event_id', event.id)
    expect(rows).toHaveLength(1)
  })

  it('D)/replay — evento failed pode ser reprocessado; ao suceder, error é limpo', async () => {
    const event = trackedEvent()
    const created = await recordWebhookEvent(admin, event)
    await markWebhookEventFailed(admin, created.id, 'falha simulada de processamento (Stripe 5.4A)')

    const { data: afterFail } = await admin.from('billing_webhook_events').select('status, error').eq('stripe_event_id', event.id).single()
    expect(afterFail?.status).toBe('failed')
    expect(afterFail?.error).toBe('falha simulada de processamento (Stripe 5.4A)')

    // Segunda entrega do MESMO evento — retry legítimo do Stripe.
    const retried = await recordWebhookEvent(admin, event)
    expect(retried.outcome).toBe('duplicate')
    expect(retried.status).toBe('failed')
    expect(decideWebhookAction(retried)).toBe('process') // retry permitido

    await markWebhookEventProcessed(admin, retried.id)

    const { data: afterRetry } = await admin.from('billing_webhook_events').select('status, error').eq('stripe_event_id', event.id).single()
    expect(afterRetry?.status).toBe('processed')
    expect(afterRetry?.error).toBeNull() // limpo depois do retry bem-sucedido

    const { data: rows } = await admin.from('billing_webhook_events').select('id').eq('stripe_event_id', event.id)
    expect(rows).toHaveLength(1) // nunca duplicou linha entre as tentativas
  })

  it('E) evento já "processed": nova entrega não reprocessa (replay seguro)', async () => {
    const event = trackedEvent()
    const created = await recordWebhookEvent(admin, event)
    await markWebhookEventProcessed(admin, created.id)

    const { data: beforeReplay } = await admin.from('billing_webhook_events').select('processed_at').eq('stripe_event_id', event.id).single()

    const replay = await recordWebhookEvent(admin, event)
    expect(decideWebhookAction(replay)).toBe('skip_processed')

    const { data: afterReplay } = await admin.from('billing_webhook_events').select('processed_at, status').eq('stripe_event_id', event.id).single()
    expect(afterReplay?.status).toBe('processed')
    expect(afterReplay?.processed_at).toBe(beforeReplay?.processed_at) // nunca tocado de novo
  })

  it('F) evento desconhecido: registrado normalmente, dispatcher não quebra, chega a "processed"', async () => {
    const event = trackedEvent({ type: 'some.totally.unknown.event.v99' })
    const result = await recordWebhookEvent(admin, event)
    expect(result.outcome).toBe('new')

    const dispatch = dispatchWebhookEvent(event)
    expect(dispatch.recognized).toBe(false)
    await expect(markWebhookEventProcessed(admin, result.id)).resolves.toBeUndefined()

    const { data: row } = await admin.from('billing_webhook_events').select('status, type').eq('stripe_event_id', event.id).single()
    expect(row?.status).toBe('processed')
    expect(row?.type).toBe('some.totally.unknown.event.v99')
  })

  describe('G) RLS não foi enfraquecida', () => {
    it('usuário comum autenticado não lê nem escreve em billing_webhook_events', async () => {
      const user = await createDisposableUser(admin, 'webhook-rls')
      try {
        const userClient = await signInAsDisposableUser(env, user)

        // ACHADO desta auditoria: diferente de billing_customers/subscriptions
        // (RLS habilitada + zero policy permissiva → resultado vazio
        // silencioso), billing_webhook_events não tem NENHUM GRANT para o
        // papel `authenticated` — a proteção acontece uma camada antes da
        // RLS, como "permission denied" (42501) explícito. Ainda mais
        // restritivo, nunca mais permissivo — comportamento correto,
        // preservado tal como já estava (não alterado nesta etapa).
        const { data: selectData, error: selectError } = await userClient.from('billing_webhook_events').select('id').limit(1)
        expect(selectError).not.toBeNull()
        expect(selectError?.code).toBe('42501')
        expect(selectData).toBeNull()

        const { error: insertError } = await userClient
          .from('billing_webhook_events')
          .insert({ stripe_event_id: `evt_rls_${Date.now()}`, type: 'checkout.session.completed', payload: {}, status: 'received' })
        expect(insertError).not.toBeNull()
        expect(insertError?.code).toBe('42501')
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })
  })

  describe('Pipeline completo (assinatura real + persistência real)', () => {
    it('assinatura válida (SDK real, TEST MODE) → registra → dispatcher reconhece → processed', async () => {
      const stripe = getStripeClient() // TEST MODE real (assertStripeTestMode já validado)
      const eventPayload = makeSyntheticEventPayload({ type: 'checkout.session.completed' })
      insertedEventIds.add(eventPayload.id)

      const payloadString = JSON.stringify(eventPayload)
      const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: SYNTHETIC_WEBHOOK_SECRET })

      const verifiedEvent = verifyStripeWebhookEvent(stripe, payloadString, signatureHeader, SYNTHETIC_WEBHOOK_SECRET)
      expect(verifiedEvent.id).toBe(eventPayload.id)

      const record = await recordWebhookEvent(admin, verifiedEvent)
      expect(decideWebhookAction(record)).toBe('process')

      const dispatch = dispatchWebhookEvent(verifiedEvent)
      expect(dispatch.recognized).toBe(true)
      await markWebhookEventProcessed(admin, record.id)

      const { data: row } = await admin.from('billing_webhook_events').select('status').eq('stripe_event_id', eventPayload.id).single()
      expect(row?.status).toBe('processed')
    })

    it('assinatura com secret errado é rejeitada ANTES de qualquer escrita em billing_webhook_events', async () => {
      const stripe = getStripeClient()
      const eventPayload = makeSyntheticEventPayload()
      const payloadString = JSON.stringify(eventPayload)
      const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: SYNTHETIC_WEBHOOK_SECRET })

      const wrongSecret = `whsec_wrong_${'e'.repeat(24)}`
      expect(() => verifyStripeWebhookEvent(stripe, payloadString, signatureHeader, wrongSecret)).toThrow()

      const { data: rows } = await admin.from('billing_webhook_events').select('id').eq('stripe_event_id', eventPayload.id)
      expect(rows).toEqual([]) // nada foi persistido — a rejeição acontece antes de qualquer tentativa de INSERT
    })
  })

  afterAll(async () => {
    const { count } = await admin.from('billing_webhook_events').select('id', { count: 'exact', head: true })
    expect(count ?? 0).toBe(0) // nenhum resíduo desta suíte — tudo limpo em afterEach
  })
})
