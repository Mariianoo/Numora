/**
 * tests/unit/stripe-customer.test.ts
 * Etapa "Stripe 5.2 — Customer Foundation" — `getOrCreateBillingCustomer`
 * (lib/stripe/customer.ts), com Supabase E Stripe MOCKADOS — nenhuma
 * chamada real acontece aqui (a prova contra Supabase DEV real + Stripe
 * TEST MODE real está em
 * tests/integration/stripe-customer-foundation.test.ts).
 *
 * Este arquivo cobre especificamente os cenários de FALHA/corrida da FASE
 * 9 que não são seguros/determinísticos de forçar contra o Stripe real
 * (o Stripe não "falha sob demanda"): erro do Stripe ao criar, erro do
 * Supabase ao inserir, e a corrida de unicidade tratada como reaproveitamento.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getOrCreateBillingCustomer, resolveBillingCustomerByStripeCustomerId } from '@/lib/stripe/customer'
import { buildCreationIdempotencyKey } from '@/lib/stripe/idempotency'

interface MockSupabaseOptions {
  /** Resultado(s) sucessivo(s) da consulta por user_id — um por chamada (1ª tentativa, releitura pós-corrida etc). */
  selectResults: Array<{ data: { id: string; stripe_customer_id: string | null } | null; error: { message: string } | null }>
  insertResult?: { data: { id: string } | null; error: { code?: string; message: string } | null }
}

function makeMockSupabase({ selectResults, insertResult }: MockSupabaseOptions) {
  const maybeSingle = vi.fn()
  for (const result of selectResults) {
    maybeSingle.mockResolvedValueOnce(result)
  }
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })

  const single = vi.fn().mockResolvedValue(insertResult ?? { data: null, error: null })
  const selectAfterInsert = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select: selectAfterInsert })

  const from = vi.fn().mockReturnValue({ select, insert })
  return { client: { from } as unknown as SupabaseClient, from, select, insert, eq, maybeSingle, single }
}

function makeMockStripe(createImpl: (...args: unknown[]) => unknown) {
  const create = vi.fn().mockImplementation(createImpl)
  return { client: { customers: { create } } as unknown as Stripe, create }
}

describe('getOrCreateBillingCustomer', () => {
  it('usuário sem billing_customer: cria no Stripe (com Idempotency-Key determinística) e persiste localmente', async () => {
    const { client: supabase, from, insert } = makeMockSupabase({
      selectResults: [{ data: null, error: null }],
      insertResult: { data: { id: 'bc_1' }, error: null },
    })
    const { client: stripe, create } = makeMockStripe(() => ({ id: 'cus_abc' }))

    const result = await getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: 'user1@example.com' })

    expect(result).toEqual({ billingCustomerId: 'bc_1', stripeCustomerId: 'cus_abc', created: true })
    expect(from).toHaveBeenCalledWith('billing_customers')
    expect(create).toHaveBeenCalledWith(
      { email: 'user1@example.com', metadata: { numora_user_id: 'user-1' } },
      { idempotencyKey: buildCreationIdempotencyKey('customer', 'user-1') },
    )
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', stripe_customer_id: 'cus_abc' })
  })

  it('email null é enviado ao Stripe como undefined, nunca inventado', async () => {
    const { client: supabase } = makeMockSupabase({
      selectResults: [{ data: null, error: null }],
      insertResult: { data: { id: 'bc_1' }, error: null },
    })
    const { client: stripe, create } = makeMockStripe(() => ({ id: 'cus_abc' }))

    await getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })

    expect(create).toHaveBeenCalledWith(
      { email: undefined, metadata: { numora_user_id: 'user-1' } },
      { idempotencyKey: buildCreationIdempotencyKey('customer', 'user-1') },
    )
  })

  it('usuário já com billing_customer: reutiliza, nunca chama o Stripe', async () => {
    const { client: supabase } = makeMockSupabase({
      selectResults: [{ data: { id: 'bc_1', stripe_customer_id: 'cus_existing' }, error: null }],
    })
    const { client: stripe, create } = makeMockStripe(() => ({ id: 'cus_never' }))

    const result = await getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: 'user1@example.com' })

    expect(result).toEqual({ billingCustomerId: 'bc_1', stripeCustomerId: 'cus_existing', created: false })
    expect(create).not.toHaveBeenCalled()
  })

  it('billing_customer existente com stripe_customer_id vazio é um estado inconsistente — lança, nunca inventa', async () => {
    const { client: supabase } = makeMockSupabase({
      selectResults: [{ data: { id: 'bc_1', stripe_customer_id: null }, error: null }],
    })
    const { client: stripe } = makeMockStripe(() => ({ id: 'cus_never' }))

    await expect(getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })).rejects.toThrow(/inconsistente/)
  })

  it('FASE 9.1 — erro do Stripe ao criar Customer propaga SEM tentar inserir localmente', async () => {
    const { client: supabase, insert } = makeMockSupabase({ selectResults: [{ data: null, error: null }] })
    const { client: stripe } = makeMockStripe(() => {
      throw new Error('stripe indisponível (simulado)')
    })

    await expect(getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })).rejects.toThrow(/stripe indisponível/)
    expect(insert).not.toHaveBeenCalled()
  })

  it('erro do Supabase ao consultar billing_customers propaga com contexto', async () => {
    const { client: supabase } = makeMockSupabase({ selectResults: [{ data: null, error: { message: 'falha de leitura simulada' } }] })
    const { client: stripe } = makeMockStripe(() => ({ id: 'cus_abc' }))

    await expect(getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })).rejects.toThrow(/falha de leitura simulada/)
  })

  it('FASE 9.2 — falha de INSERT não relacionada a corrida (ex.: erro transitório) propaga, Customer Stripe já foi criado (nenhum rollback cross-sistema)', async () => {
    const { client: supabase } = makeMockSupabase({
      selectResults: [{ data: null, error: null }],
      insertResult: { data: null, error: { code: '08000', message: 'conexão perdida (simulado)' } },
    })
    const { client: stripe, create } = makeMockStripe(() => ({ id: 'cus_abc' }))

    await expect(getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })).rejects.toThrow(/conexão perdida/)
    expect(create).toHaveBeenCalledTimes(1) // Stripe foi chamado — reexecutar depois usa a MESMA Idempotency-Key, nunca duplica
  })

  it('FASE 6/9.3 — corrida (23505 no INSERT): relê e reutiliza a linha da requisição vencedora, nunca lança', async () => {
    const { client: supabase } = makeMockSupabase({
      selectResults: [
        { data: null, error: null }, // 1ª leitura: ainda não existe
        { data: { id: 'bc_winner', stripe_customer_id: 'cus_abc' }, error: null }, // releitura pós-corrida
      ],
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    const { client: stripe } = makeMockStripe(() => ({ id: 'cus_abc' }))

    const result = await getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })

    expect(result).toEqual({ billingCustomerId: 'bc_winner', stripeCustomerId: 'cus_abc', created: false })
  })

  it('corrida (23505) mas a releitura não encontra nada: erro explícito, nunca finge sucesso', async () => {
    const { client: supabase } = makeMockSupabase({
      selectResults: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    const { client: stripe } = makeMockStripe(() => ({ id: 'cus_abc' }))

    await expect(getOrCreateBillingCustomer(supabase, stripe, { userId: 'user-1', email: null })).rejects.toThrow(/Conflito de unicidade/)
  })
})

/**
 * Etapa "5.10F — Account Deletion x Async Stripe Webhook Race Fix" —
 * `resolveBillingCustomerByStripeCustomerId` com Supabase MOCKADO (a prova
 * contra DEV real está em tests/integration/stripe-customer-foundation.test.ts).
 * Cobre exatamente os 3 caminhos do resultado discriminado: `found` (igual
 * a sempre), `tombstoned` (novo — só com prova positiva em
 * deleted_billing_customers) e o erro fail-closed inalterado quando nenhuma
 * das duas tabelas tem o Customer.
 */
interface MockResolveSupabaseOptions {
  billingCustomer?: { data: { id: string; user_id: string } | null; error: { message: string } | null }
  deletedBillingCustomer?: { data: { stripe_customer_id: string; user_id: string; deleted_at: string } | null; error: { message: string } | null }
}

function makeMockResolveSupabase(opts: MockResolveSupabaseOptions) {
  const fromCalls: string[] = []
  const from = vi.fn((table: string) => {
    fromCalls.push(table)
    if (table === 'billing_customers') {
      const maybeSingle = vi.fn().mockResolvedValue(opts.billingCustomer ?? { data: null, error: null })
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }
    if (table === 'deleted_billing_customers') {
      const maybeSingle = vi.fn().mockResolvedValue(opts.deletedBillingCustomer ?? { data: null, error: null })
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }
    throw new Error(`tabela inesperada nesta suíte: ${table}`)
  })
  return { client: { from } as unknown as SupabaseClient, from, fromCalls }
}

describe('resolveBillingCustomerByStripeCustomerId — Etapa 5.10F', () => {
  it('customer encontrado em billing_customers → kind "found", nunca consulta o tombstone', async () => {
    const { client: supabase, fromCalls } = makeMockResolveSupabase({
      billingCustomer: { data: { id: 'bc-1', user_id: 'user-1' }, error: null },
    })

    const result = await resolveBillingCustomerByStripeCustomerId(supabase, 'cus_abc')

    expect(result).toEqual({ kind: 'found', customer: { id: 'bc-1', userId: 'user-1' } })
    expect(fromCalls).toEqual(['billing_customers']) // curto-circuita — nunca olha o tombstone se já achou
  })

  it('customer ausente de billing_customers mas presente em deleted_billing_customers → kind "tombstoned"', async () => {
    const { client: supabase } = makeMockResolveSupabase({
      billingCustomer: { data: null, error: null },
      deletedBillingCustomer: { data: { stripe_customer_id: 'cus_abc', user_id: 'user-1', deleted_at: '2026-09-11T00:00:00.000Z' }, error: null },
    })

    const result = await resolveBillingCustomerByStripeCustomerId(supabase, 'cus_abc')

    expect(result).toEqual({
      kind: 'tombstoned',
      tombstone: { stripeCustomerId: 'cus_abc', userId: 'user-1', deletedAt: '2026-09-11T00:00:00.000Z' },
    })
  })

  it('customer ausente das DUAS tabelas → erro fail-closed inalterado, nunca sucesso silencioso', async () => {
    const { client: supabase } = makeMockResolveSupabase({
      billingCustomer: { data: null, error: null },
      deletedBillingCustomer: { data: null, error: null },
    })

    await expect(resolveBillingCustomerByStripeCustomerId(supabase, 'cus_desconhecido')).rejects.toThrow(
      /não tem billing_customer local vinculado \(nem tombstone de exclusão\)/,
    )
  })

  it('erro do Supabase ao consultar o tombstone propaga com contexto, nunca é engolido', async () => {
    const { client: supabase } = makeMockResolveSupabase({
      billingCustomer: { data: null, error: null },
      deletedBillingCustomer: { data: null, error: { message: 'falha de leitura simulada' } },
    })

    await expect(resolveBillingCustomerByStripeCustomerId(supabase, 'cus_abc')).rejects.toThrow(/falha de leitura simulada/)
  })
})
