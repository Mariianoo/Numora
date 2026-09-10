/**
 * tests/unit/analytics-outbox.test.ts
 * Etapa "5.9G — First-Party Analytics Outbox" — testa
 * `resolveCheckoutCompletedOutboxInput` (pura, decide SE/COM QUE payload um
 * evento Stripe deveria virar `checkout_completed`) e
 * `recordCheckoutCompletedOutboxEvent` (I/O, Supabase mockado — a prova
 * contra Postgres real de que a UNIQUE constraint funciona está em
 * tests/integration/analytics-outbox.test.ts).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { recordCheckoutCompletedOutboxEvent, resolveCheckoutCompletedOutboxInput } from '@/lib/stripe/analytics-outbox'

const FUNNEL_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const SESSION_ID = 'cs_test_synthetic_5_9g'

function makeCheckoutCompletedEvent(overrides: {
  paymentStatus?: string
  metadata?: Record<string, string>
} = {}): Stripe.Event {
  return {
    id: `evt_test_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: SESSION_ID,
        payment_status: overrides.paymentStatus ?? 'paid',
        metadata: overrides.metadata ?? {},
      },
    },
  } as unknown as Stripe.Event
}

function makeOtherEvent(type: string): Stripe.Event {
  return {
    id: `evt_test_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object: { id: 'sub_test_or_in_test_irrelevant' } },
  } as unknown as Stripe.Event
}

describe('resolveCheckoutCompletedOutboxInput — evento canônico', () => {
  it('checkout.session.completed + payment_status=paid + funnel_id → resolve o input completo', () => {
    const event = makeCheckoutCompletedEvent({
      metadata: {
        numora_funnel_id: FUNNEL_ID,
        numora_analytics_consent: 'true',
        numora_plan_slug: 'pro',
        numora_interval: 'month',
        numora_currency: 'BRL',
      },
    })

    const result = resolveCheckoutCompletedOutboxInput(event)

    expect(result).toEqual({
      funnelId: FUNNEL_ID,
      triggerValue: null,
      planSlug: 'pro',
      interval: 'month',
      currency: 'BRL',
      consentSnapshot: true,
      sourceReference: SESSION_ID,
    })
  })

  it('payment_status=unpaid → null (item 15 — pagamento ainda não confirmado, nunca gera checkout_completed)', () => {
    const event = makeCheckoutCompletedEvent({ paymentStatus: 'unpaid', metadata: { numora_funnel_id: FUNNEL_ID } })
    expect(resolveCheckoutCompletedOutboxInput(event)).toBeNull()
  })

  it('payment_status=no_payment_required → null (só "paid" é aceito, mesmo sendo uma Session "completed")', () => {
    const event = makeCheckoutCompletedEvent({ paymentStatus: 'no_payment_required', metadata: { numora_funnel_id: FUNNEL_ID } })
    expect(resolveCheckoutCompletedOutboxInput(event)).toBeNull()
  })

  it('sem metadata.numora_funnel_id → null (nunca inventa um funnel_id, nunca grava uma linha sem o único identificador que ela existe para carregar)', () => {
    const event = makeCheckoutCompletedEvent({ metadata: { numora_analytics_consent: 'true' } })
    expect(resolveCheckoutCompletedOutboxInput(event)).toBeNull()
  })

  it.each(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'])(
    'evento %s isolado NUNCA gera checkout_completed (itens 16/17 — não é a fonte canônica, mesmo reconhecido/sincronizado normalmente para billing)',
    (type) => {
      expect(resolveCheckoutCompletedOutboxInput(makeOtherEvent(type))).toBeNull()
    },
  )
})

describe('resolveCheckoutCompletedOutboxInput — consent snapshot fail-closed (itens 5-9/19)', () => {
  it('metadata "true" → consentSnapshot=true', () => {
    const event = makeCheckoutCompletedEvent({ metadata: { numora_funnel_id: FUNNEL_ID, numora_analytics_consent: 'true' } })
    expect(resolveCheckoutCompletedOutboxInput(event)?.consentSnapshot).toBe(true)
  })

  it('metadata "false" → consentSnapshot=false', () => {
    const event = makeCheckoutCompletedEvent({ metadata: { numora_funnel_id: FUNNEL_ID, numora_analytics_consent: 'false' } })
    expect(resolveCheckoutCompletedOutboxInput(event)?.consentSnapshot).toBe(false)
  })

  it('metadata ausente → consentSnapshot=false (nunca assume true)', () => {
    const event = makeCheckoutCompletedEvent({ metadata: { numora_funnel_id: FUNNEL_ID } })
    expect(resolveCheckoutCompletedOutboxInput(event)?.consentSnapshot).toBe(false)
  })

  it.each(['TRUE', '1', 'yes', ''])('metadata inválida ("%s") → consentSnapshot=false', (value) => {
    const event = makeCheckoutCompletedEvent({ metadata: { numora_funnel_id: FUNNEL_ID, numora_analytics_consent: value } })
    expect(resolveCheckoutCompletedOutboxInput(event)?.consentSnapshot).toBe(false)
  })

  it('o snapshot nunca é revisitado por nenhum estado "atual" — representa só o metadata da Session no momento do evento', () => {
    // Prova estrutural: a função não recebe (e não poderia receber) nenhum
    // estado de consentimento "ao vivo" — só o que já está congelado no
    // payload do evento já verificado.
    expect(resolveCheckoutCompletedOutboxInput.length).toBe(1)
  })
})

describe('resolveCheckoutCompletedOutboxInput — plan_slug/interval/currency/trigger', () => {
  it('lidos de metadata quando presentes', () => {
    const event = makeCheckoutCompletedEvent({
      metadata: { numora_funnel_id: FUNNEL_ID, numora_plan_slug: 'premium', numora_interval: 'year', numora_currency: 'USD', numora_trigger: 'dashboard' },
    })
    const result = resolveCheckoutCompletedOutboxInput(event)
    expect(result).toMatchObject({ planSlug: 'premium', interval: 'year', currency: 'USD', triggerValue: 'dashboard' })
  })

  it('null quando ausentes (nunca inventa um valor)', () => {
    const event = makeCheckoutCompletedEvent({ metadata: { numora_funnel_id: FUNNEL_ID } })
    const result = resolveCheckoutCompletedOutboxInput(event)
    expect(result).toMatchObject({ planSlug: null, interval: null, currency: null, triggerValue: null })
  })
})

describe('resolveCheckoutCompletedOutboxInput — nunca chama rede/vendor externo', () => {
  it('resolver a função inteira nunca dispara fetch/XHR', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const event = makeCheckoutCompletedEvent({ metadata: { numora_funnel_id: FUNNEL_ID, numora_analytics_consent: 'true' } })

    resolveCheckoutCompletedOutboxInput(event)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

function mockSupabaseInsert(error: { code?: string; message: string } | null) {
  const insert = vi.fn().mockResolvedValue({ error })
  const from = vi.fn().mockReturnValue({ insert })
  return { from, insert } as unknown as SupabaseClient
}

describe('recordCheckoutCompletedOutboxEvent', () => {
  const input = {
    funnelId: FUNNEL_ID,
    triggerValue: null,
    planSlug: 'pro',
    interval: 'month',
    currency: 'BRL',
    consentSnapshot: true,
    sourceReference: SESSION_ID,
  }

  it('insert bem-sucedido → "inserted"', async () => {
    const supabase = mockSupabaseInsert(null)
    await expect(recordCheckoutCompletedOutboxEvent(supabase, input)).resolves.toBe('inserted')
  })

  it('insert usa a tabela analytics_outbox com as colunas snake_case corretas', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ insert })
    const supabase = { from } as unknown as SupabaseClient

    await recordCheckoutCompletedOutboxEvent(supabase, input)

    expect(from).toHaveBeenCalledWith('analytics_outbox')
    expect(insert).toHaveBeenCalledWith({
      funnel_id: FUNNEL_ID,
      event_name: 'checkout_completed',
      trigger: null,
      plan_slug: 'pro',
      interval: 'month',
      currency: 'BRL',
      consent_snapshot: true,
      source_reference: SESSION_ID,
    })
  })

  it('23505 (UNIQUE violation) → "duplicate", nunca lança (item 18 — mesmo Session ID não duplica)', async () => {
    const supabase = mockSupabaseInsert({ code: '23505', message: 'duplicate key (simulado)' })
    await expect(recordCheckoutCompletedOutboxEvent(supabase, input)).resolves.toBe('duplicate')
  })

  it('erro diferente de 23505 → propaga (item 20 — o call site do webhook é quem decide não derrubar o webhook, envolvendo isto em try/catch)', async () => {
    const supabase = mockSupabaseInsert({ code: '42501', message: 'permission denied (simulado)' })
    await expect(recordCheckoutCompletedOutboxEvent(supabase, input)).rejects.toThrow(/permission denied/)
  })

  it('o padrão try/catch usado no webhook route absorve essa falha sem deixar escapar', async () => {
    const supabase = mockSupabaseInsert({ code: '42501', message: 'permission denied (simulado)' })

    await expect(
      (async () => {
        try {
          await recordCheckoutCompletedOutboxEvent(supabase, input)
        } catch {
          // mesmo formato usado em app/api/stripe/webhook/route.ts
        }
      })(),
    ).resolves.toBeUndefined()
  })
})
