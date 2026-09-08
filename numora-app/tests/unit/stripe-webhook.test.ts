/**
 * tests/unit/stripe-webhook.test.ts
 * Etapa "Stripe 5.4A — Webhook Foundation" — verificação de assinatura
 * (SDK real, `stripe.webhooks.constructEvent`/`generateTestHeaderString` —
 * operações puramente locais, nunca uma chamada de rede), persistência
 * idempotente (Supabase MOCKADO) e dispatcher.
 *
 * O client Stripe usado aqui é construído com uma chave SINTÉTICA
 * (`sk_test_` + preenchimento — nunca uma chave real) só para expor
 * `.webhooks`, que nunca faz chamada HTTP. O segredo de webhook também é
 * SINTÉTICO, gerado in-memory só para este arquivo — nunca o valor real
 * de `STRIPE_WEBHOOK_SECRET` (que sequer está configurado hoje), nunca
 * persistido em lugar nenhum.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { assertStripeWebhookSecretFormat } from '@/lib/stripe/assert-webhook-secret-format'
import {
  decideWebhookAction,
  dispatchWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
  verifyStripeWebhookEvent,
} from '@/lib/stripe/webhook'

const FAKE_TEST_KEY = `sk_test_${'a'.repeat(32)}` // sintética, nunca real — só para acessar stripe.webhooks (sem rede)
const FAKE_WEBHOOK_SECRET = `whsec_${'b'.repeat(32)}` // sintética, gerada só para este arquivo — nunca persistida
const stripe = new Stripe(FAKE_TEST_KEY, { apiVersion: '2026-08-26.dahlia' })

function signPayload(payload: Record<string, unknown>, secret: string = FAKE_WEBHOOK_SECRET) {
  const payloadString = JSON.stringify(payload)
  const header = stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret })
  return { payloadString, header }
}

function makeEventPayload(overrides: Partial<{ id: string; type: string }> = {}) {
  return {
    id: overrides.id ?? 'evt_test_123',
    object: 'event',
    type: overrides.type ?? 'checkout.session.completed',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cs_test_abc' } },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  }
}

describe('verifyStripeWebhookEvent — assinatura', () => {
  it('1) assinatura válida: retorna o Event verificado', () => {
    const { payloadString, header } = signPayload(makeEventPayload())
    const event = verifyStripeWebhookEvent(stripe, payloadString, header, FAKE_WEBHOOK_SECRET)
    expect(event.id).toBe('evt_test_123')
  })

  it('2) assinatura inválida (secret errado): lança', () => {
    const { payloadString, header } = signPayload(makeEventPayload(), FAKE_WEBHOOK_SECRET)
    const wrongSecret = `whsec_${'c'.repeat(32)}`
    expect(() => verifyStripeWebhookEvent(stripe, payloadString, header, wrongSecret)).toThrow()
  })

  it('3) payload adulterado depois de assinado: lança (corpo não bate mais com a assinatura)', () => {
    const { payloadString, header } = signPayload(makeEventPayload())
    const tampered = payloadString.replace('checkout.session.completed', 'customer.subscription.deleted')
    expect(() => verifyStripeWebhookEvent(stripe, tampered, header, FAKE_WEBHOOK_SECRET)).toThrow()
  })

  it('6) event_id é extraído corretamente do payload verificado', () => {
    const { payloadString, header } = signPayload(makeEventPayload({ id: 'evt_test_specifico' }))
    const event = verifyStripeWebhookEvent(stripe, payloadString, header, FAKE_WEBHOOK_SECRET)
    expect(event.id).toBe('evt_test_specifico')
  })

  it('7) event type é extraído corretamente do payload verificado', () => {
    const { payloadString, header } = signPayload(makeEventPayload({ type: 'customer.subscription.updated' }))
    const event = verifyStripeWebhookEvent(stripe, payloadString, header, FAKE_WEBHOOK_SECRET)
    expect(event.type).toBe('customer.subscription.updated')
  })

  it('16) o erro de assinatura inválida nunca inclui o valor do secret usado', () => {
    const { payloadString, header } = signPayload(makeEventPayload())
    const wrongSecret = `whsec_${'c'.repeat(32)}`
    try {
      verifyStripeWebhookEvent(stripe, payloadString, header, wrongSecret)
      throw new Error('deveria ter lançado')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain(wrongSecret)
      expect(message).not.toContain(FAKE_WEBHOOK_SECRET)
    }
  })
})

describe('assertStripeWebhookSecretFormat', () => {
  it('4) secret ausente: lança "ausente", nunca revela nada porque não há nada a revelar', () => {
    expect(() => assertStripeWebhookSecretFormat(undefined)).toThrow(/ausente/)
  })

  it('5) secret com formato inválido: lança "formato", nunca ecoa o valor recebido na mensagem', () => {
    const badValue = 'isso-nao-e-um-whsec-valido'
    try {
      assertStripeWebhookSecretFormat(badValue)
      throw new Error('deveria ter lançado')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toMatch(/formato/)
      expect(message).not.toContain(badValue)
    }
  })

  it('aceita um valor no formato whsec_... sem lançar', () => {
    expect(() => assertStripeWebhookSecretFormat(FAKE_WEBHOOK_SECRET)).not.toThrow()
  })
})

function makeMockSupabase(opts: { insertResult: { data: { id: string; status: string } | null; error: { code?: string; message: string } | null }; selectResult?: { data: { id: string; status: string } | null; error: { message: string } | null }; updateResult?: { error: { message: string } | null } }) {
  const insertSingle = vi.fn().mockResolvedValue(opts.insertResult)
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })

  const selectSingle = vi.fn().mockResolvedValue(opts.selectResult ?? { data: null, error: null })
  const selectEq = vi.fn().mockReturnValue({ single: selectSingle })
  const select = vi.fn().mockReturnValue({ eq: selectEq })

  const updateEq = vi.fn().mockResolvedValue(opts.updateResult ?? { error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })

  const from = vi.fn().mockReturnValue({ insert, select, update })
  return { client: { from } as unknown as SupabaseClient, from, insert, select, update, updateEq }
}

describe('recordWebhookEvent — idempotência', () => {
  it('8) evento novo: outcome "new"', async () => {
    const { client } = makeMockSupabase({ insertResult: { data: { id: 'row-1', status: 'received' }, error: null } })
    const result = await recordWebhookEvent(client, makeEventPayload() as unknown as Parameters<typeof recordWebhookEvent>[1])
    expect(result).toEqual({ outcome: 'new', id: 'row-1', status: 'received' })
  })

  it('9) evento duplicado (23505 no insert): relê e devolve outcome "duplicate" com o status atual', async () => {
    const { client } = makeMockSupabase({
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
      selectResult: { data: { id: 'row-1', status: 'received' }, error: null },
    })
    const result = await recordWebhookEvent(client, makeEventPayload() as unknown as Parameters<typeof recordWebhookEvent>[1])
    expect(result).toEqual({ outcome: 'duplicate', id: 'row-1', status: 'received' })
  })

  it('13) erro de persistência não relacionado a corrida: propaga', async () => {
    const { client } = makeMockSupabase({ insertResult: { data: null, error: { code: '08000', message: 'conexão perdida (simulado)' } } })
    await expect(recordWebhookEvent(client, makeEventPayload() as unknown as Parameters<typeof recordWebhookEvent>[1])).rejects.toThrow(/conexão perdida/)
  })
})

describe('decideWebhookAction — replay/retry/concorrência', () => {
  it('evento novo → process', () => {
    expect(decideWebhookAction({ outcome: 'new', id: 'x', status: 'received' })).toBe('process')
  })

  it('10) duplicado + já processed → skip_processed (nunca reprocessa)', () => {
    expect(decideWebhookAction({ outcome: 'duplicate', id: 'x', status: 'processed' })).toBe('skip_processed')
  })

  it('11)/12) duplicado + failed → process (retry legítimo)', () => {
    expect(decideWebhookAction({ outcome: 'duplicate', id: 'x', status: 'failed' })).toBe('process')
  })

  it('duplicado + ainda received (corrida em andamento) → skip_in_progress', () => {
    expect(decideWebhookAction({ outcome: 'duplicate', id: 'x', status: 'received' })).toBe('skip_in_progress')
  })
})

describe('markWebhookEventProcessed / markWebhookEventFailed', () => {
  it('marca processed e limpa error (útil depois de um retry bem-sucedido)', async () => {
    const { client, update } = makeMockSupabase({ insertResult: { data: null, error: null } })
    await markWebhookEventProcessed(client, 'row-1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed', error: null }))
  })

  it('14) marca failed com a mensagem de erro, nunca com um secret', async () => {
    const { client, update } = makeMockSupabase({ insertResult: { data: null, error: null } })
    await markWebhookEventFailed(client, 'row-1', 'falha simulada no processamento')
    expect(update).toHaveBeenCalledWith({ status: 'failed', error: 'falha simulada no processamento' })
  })

  it('propaga erro se o UPDATE falhar', async () => {
    const { client } = makeMockSupabase({ insertResult: { data: null, error: null }, updateResult: { error: { message: 'update falhou (simulado)' } } })
    await expect(markWebhookEventFailed(client, 'row-1', 'algo')).rejects.toThrow(/update falhou/)
  })
})

describe('dispatchWebhookEvent — reconhecimento (Stripe 5.4A: sem lógica de negócio)', () => {
  it('reconhece os eventos que a Stripe 5.4B vai implementar', () => {
    for (const type of ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']) {
      const result = dispatchWebhookEvent(makeEventPayload({ type }) as unknown as Parameters<typeof dispatchWebhookEvent>[0])
      expect(result.recognized).toBe(true)
    }
  })

  it('15) evento desconhecido: recognized=false, nunca lança', () => {
    const result = dispatchWebhookEvent(makeEventPayload({ type: 'some.totally.unknown.event.v99' }) as unknown as Parameters<typeof dispatchWebhookEvent>[0])
    expect(result.recognized).toBe(false)
  })

  it('17)/18) o dispatcher não recebe nenhum client Supabase — estruturalmente não tem como criar subscription/alterar entitlement', () => {
    expect(dispatchWebhookEvent.length).toBe(1) // só (event) — nenhum parâmetro de escrita
    const result = dispatchWebhookEvent(makeEventPayload() as unknown as Parameters<typeof dispatchWebhookEvent>[0])
    expect(Object.keys(result)).toEqual(['recognized']) // nenhum efeito colateral relatado — só reconhecimento
  })
})
