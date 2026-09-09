/**
 * tests/unit/stripe-invoice-sync.test.ts
 * Etapa "Stripe 5.5 — Invoice & Payment Sync" — `syncInvoicePaid`/
 * `syncInvoicePaymentFailed` (lib/stripe/invoice-sync.ts), com Stripe E
 * Supabase MOCKADOS — nenhuma chamada real (a prova contra DEV real +
 * Stripe TEST real está em tests/integration/stripe-invoice-sync.test.ts).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { syncInvoicePaid, syncInvoicePaymentFailed } from '@/lib/stripe/invoice-sync'
import { fromStripeMinorUnits } from '@/lib/stripe/minor-units'

const BILLING_CUSTOMER = { id: 'bc-uuid-1', user_id: 'user-uuid-1' }

function makeInvoice(overrides: Partial<Record<string, unknown>> = {}): Stripe.Invoice {
  return {
    id: 'in_test_123',
    object: 'invoice',
    customer: 'cus_test_abc',
    currency: 'brl',
    amount_paid: 1990,
    amount_due: 1990,
    metadata: {},
    parent: null,
    payments: { data: [] },
    status_transitions: { paid_at: 1700000000 },
    ...overrides,
  } as unknown as Stripe.Invoice
}

interface MockSupabaseOptions {
  billingCustomer?: { data: { id: string; user_id: string } | null; error: { message: string } | null }
  subscriptionRow?: { data: { id: string } | null; error: { message: string } | null }
  rpcResult?: { data: { transaction_id: string; previous_status: string | null; new_status: string } | null; error: { code?: string; message: string } | null }
}

function makeMockSupabase(opts: MockSupabaseOptions) {
  const rpcCalls: Array<{ name: string; params: unknown }> = []
  const fromCalls: string[] = []

  const from = vi.fn((table: string) => {
    fromCalls.push(table)
    if (table === 'billing_customers') {
      const maybeSingle = vi.fn().mockResolvedValue(opts.billingCustomer ?? { data: BILLING_CUSTOMER, error: null })
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }
    if (table === 'subscriptions') {
      const maybeSingle = vi.fn().mockResolvedValue(opts.subscriptionRow ?? { data: null, error: null })
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }
    throw new Error(`tabela inesperada nesta suíte: ${table}`)
  })

  const rpcSingle = vi.fn().mockResolvedValue(opts.rpcResult ?? { data: { transaction_id: 'tx-uuid-1', previous_status: null, new_status: 'paid' }, error: null })
  const rpc = vi.fn((name: string, params: unknown) => {
    rpcCalls.push({ name, params })
    return { single: rpcSingle }
  })

  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, rpcCalls, fromCalls }
}

function makeMockStripe(invoice: Stripe.Invoice) {
  const retrieve = vi.fn().mockResolvedValue(invoice)
  return { client: { invoices: { retrieve } } as unknown as Stripe, retrieve }
}

describe('syncInvoicePaid', () => {
  it('1) cria a transação corretamente: resolve Customer, converte valor, normaliza currency, status=paid', async () => {
    const invoice = makeInvoice({ amount_paid: 1990, currency: 'brl' })
    const { client: stripe, retrieve } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    const result = await syncInvoicePaid(supabase, stripe, 'in_test_123')

    expect(retrieve).toHaveBeenCalledWith('in_test_123', { expand: ['payments'] })
    expect(result).toEqual({ outcome: 'synced', transactionId: 'tx-uuid-1', previousStatus: null, newStatus: 'paid' })
    expect(rpcCalls[0].name).toBe('sync_billing_transaction_from_invoice')
    expect(rpcCalls[0].params).toMatchObject({
      p_user_id: 'user-uuid-1',
      p_stripe_invoice_id: 'in_test_123',
      p_amount: 19.9,
      p_currency: 'BRL',
      p_status: 'paid',
      p_paid_at: new Date(1700000000 * 1000).toISOString(),
    })
  })

  it('9) BRL é normalizada para maiúsculo', async () => {
    const invoice = makeInvoice({ currency: 'brl' })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(rpcCalls[0].params).toMatchObject({ p_currency: 'BRL' })
  })

  it('10) USD é normalizada para maiúsculo', async () => {
    const invoice = makeInvoice({ currency: 'usd', amount_paid: 599 })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(rpcCalls[0].params).toMatchObject({ p_currency: 'USD', p_amount: 5.99 })
  })

  it('moeda não suportada (ex.: EUR) falha explicitamente, nunca inventa suporte', async () => {
    const invoice = makeInvoice({ currency: 'eur' })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({})

    await expect(syncInvoicePaid(supabase, stripe, 'in_test_123')).rejects.toThrow(/não é suportada/)
  })

  it('15) conversão exata de minor units — bate com fromStripeMinorUnits', async () => {
    const invoice = makeInvoice({ amount_paid: 34900 })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect((rpcCalls[0].params as { p_amount: number }).p_amount).toBe(fromStripeMinorUnits(34900))
    expect((rpcCalls[0].params as { p_amount: number }).p_amount).toBe(349)
  })

  it('7) subscription Stripe presente e local encontrada: subscription_id é associado', async () => {
    const invoice = makeInvoice({ parent: { subscription_details: { subscription: 'sub_test_123' } } })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({ subscriptionRow: { data: { id: 'local-sub-uuid' }, error: null } })

    await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(rpcCalls[0].params).toMatchObject({ p_subscription_id: 'local-sub-uuid' })
  })

  it('8) invoice sem subscription (parent=null): subscription_id=null, processamento não quebra', async () => {
    const invoice = makeInvoice({ parent: null })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls, fromCalls } = makeMockSupabase({})

    const result = await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(result.outcome).toBe('synced')
    expect(rpcCalls[0].params).toMatchObject({ p_subscription_id: null })
    expect(fromCalls).not.toContain('subscriptions') // nunca consulta subscriptions quando não há Stripe subscription id
  })

  it('subscription Stripe presente mas AINDA sem correspondência local: subscription_id=null, invoice continua sendo registrado', async () => {
    const invoice = makeInvoice({ parent: { subscription_details: { subscription: 'sub_ainda_nao_sincronizada' } } })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({ subscriptionRow: { data: null, error: null } })

    const result = await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(result.outcome).toBe('synced')
    expect(rpcCalls[0].params).toMatchObject({ p_subscription_id: null })
  })

  it('5) payment_intent disponível: é extraído de payments.data[].payment.payment_intent', async () => {
    const invoice = makeInvoice({
      payments: { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_test_abc' } }] },
    })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(rpcCalls[0].params).toMatchObject({ p_stripe_payment_intent_id: 'pi_test_abc' })
  })

  it('payment_intent ausente: null, nunca inventa valor, nunca falha por isso', async () => {
    const invoice = makeInvoice({ payments: { data: [] } })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    const result = await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(result.outcome).toBe('synced')
    expect(rpcCalls[0].params).toMatchObject({ p_stripe_payment_intent_id: null })
  })

  it('6) Customer inexistente localmente: falha explícita, nunca associa a outro usuário', async () => {
    const invoice = makeInvoice()
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({ billingCustomer: { data: null, error: null } })

    await expect(syncInvoicePaid(supabase, stripe, 'in_test_123')).rejects.toThrow(/não tem billing_customer local vinculado/)
  })

  it('invoice sem customer algum: falha explícita', async () => {
    const invoice = makeInvoice({ customer: null })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({})

    await expect(syncInvoicePaid(supabase, stripe, 'in_test_123')).rejects.toThrow(/não tem customer associado/)
  })

  it('metadata.numora_user_id incompatível: falha explícita, nunca escolhe arbitrariamente', async () => {
    const invoice = makeInvoice({ metadata: { numora_user_id: 'user-uuid-DIFERENTE' } })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({})

    await expect(syncInvoicePaid(supabase, stripe, 'in_test_123')).rejects.toThrow(/Inconsistência/)
  })

  it('metadata.numora_user_id ausente: nenhuma validação extra, não é erro', async () => {
    const invoice = makeInvoice({ metadata: {} })
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({})

    const result = await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(result.outcome).toBe('synced')
  })

  it('16) erro de persistência (RPC) propaga — permite retry, nunca mascara', async () => {
    const invoice = makeInvoice()
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({ rpcResult: { data: null, error: { message: 'conexão perdida (simulado)' } } })

    await expect(syncInvoicePaid(supabase, stripe, 'in_test_123')).rejects.toThrow(/conexão perdida/)
  })

  it('4) failed → paid: o resultado reflete a transição refletida pela RPC (previousStatus="failed", newStatus="paid")', async () => {
    const invoice = makeInvoice()
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({ rpcResult: { data: { transaction_id: 'tx-uuid-1', previous_status: 'failed', new_status: 'paid' }, error: null } })

    const result = await syncInvoicePaid(supabase, stripe, 'in_test_123')
    expect(result).toEqual({ outcome: 'synced', transactionId: 'tx-uuid-1', previousStatus: 'failed', newStatus: 'paid' })
  })
})

describe('syncInvoicePaymentFailed', () => {
  it('2) cria a transação corretamente: status=failed, paid_at sempre null, usa amount_due', async () => {
    const invoice = makeInvoice({ amount_due: 1990, amount_paid: 0, currency: 'brl' })
    const { client: stripe, retrieve } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({ rpcResult: { data: { transaction_id: 'tx-uuid-2', previous_status: null, new_status: 'failed' }, error: null } })

    const result = await syncInvoicePaymentFailed(supabase, stripe, 'in_test_123')

    expect(retrieve).toHaveBeenCalledWith('in_test_123', { expand: ['payments'] })
    expect(result.newStatus).toBe('failed')
    expect(rpcCalls[0].params).toMatchObject({ p_status: 'failed', p_paid_at: null, p_amount: 19.9 })
  })

  it('nunca altera subscription — a função não toca em nenhuma tabela além de billing_customers/subscriptions/RPC', async () => {
    const invoice = makeInvoice()
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, fromCalls, rpc } = makeMockSupabase({})

    await syncInvoicePaymentFailed(supabase, stripe, 'in_test_123')

    expect(fromCalls.every((t) => ['billing_customers', 'subscriptions'].includes(t))).toBe(true)
    expect(rpc).not.toHaveBeenCalledWith('sync_subscription_from_stripe', expect.anything())
  })

  it('6) Customer inexistente localmente: falha explícita', async () => {
    const invoice = makeInvoice()
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase } = makeMockSupabase({ billingCustomer: { data: null, error: null } })

    await expect(syncInvoicePaymentFailed(supabase, stripe, 'in_test_123')).rejects.toThrow(/não tem billing_customer local vinculado/)
  })

  it('3) failed é idempotente na camada de aplicação: sempre a mesma chamada de RPC para o mesmo invoice (dedup é responsabilidade do banco)', async () => {
    const invoice = makeInvoice()
    const { client: stripe } = makeMockStripe(invoice)
    const { client: supabase, rpcCalls } = makeMockSupabase({})

    await syncInvoicePaymentFailed(supabase, stripe, 'in_test_123')
    await syncInvoicePaymentFailed(supabase, stripe, 'in_test_123')

    expect(rpcCalls).toHaveLength(2)
    expect(rpcCalls[0].params).toEqual(rpcCalls[1].params) // mesma chamada — a UNIQUE de stripe_invoice_id no banco garante o resto
  })
})
