/**
 * tests/unit/admin-transactions-repository.test.ts
 * Etapa "Admin Transactions V1" — testa `AdminTransactionsRepository`
 * (features/billing/repositories/admin-transactions.repository.ts) com o
 * Supabase client mockado, mesmo padrão de
 * tests/unit/admin-subscriptions-repository.test.ts. Nunca a implementação
 * real, nunca rede — a garantia de RLS real (`billing_transactions_select_admin`)
 * fica a cargo de um eventual teste de integração, não duplicada aqui. Como
 * este repository usa uma query direta (`.from().select().eq().order().range()`),
 * em vez de RPC, o mock reflete essa cadeia — nunca `.rpc(...)`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabaseAdminTransactionsRepository } = await import('@/features/billing/repositories/admin-transactions.repository')

const FULL_ROW = {
  id: 'txn-1',
  user_id: 'user-1',
  amount: '29.9',
  currency: 'BRL',
  status: 'paid',
  created_at: '2026-09-01T00:00:00.000Z',
  paid_at: '2026-09-01T00:05:00.000Z',
  stripe_invoice_id: 'in_1234567890abcdef',
  stripe_payment_intent_id: 'pi_1234567890abcdef',
  profiles: { name: 'Thiago Teste', email: 'thiago@example.com' },
  subscriptions: { stripe_subscription_id: 'sub_1234567890abcdef' },
}

/** Builder self-referencial: `.select()`/`.eq()`/`.order()` devolvem o mesmo objeto (encadeável em qualquer ordem/quantidade), `.range()` é sempre a chamada terminal que resolve a Promise. */
function mockClientForList(rows: unknown[], count = rows.length, error: { message: string } | null = null) {
  const range = vi.fn().mockResolvedValue({ data: error ? null : rows, error, count: error ? null : count })
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockReturnValue(builder)
  builder.range = range
  const from = vi.fn().mockReturnValue(builder)
  return { client: { from } as unknown as SupabaseClient, from, builder, range }
}

describe('AdminTransactionsRepository.listTransactions()', () => {
  it('consulta a tabela billing_transactions (nunca uma RPC)', async () => {
    const { client, from } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    await repo.listTransactions({})

    expect(from).toHaveBeenCalledWith('billing_transactions')
  })

  it('pede count exato e embute profiles(name,email) e subscriptions(stripe_subscription_id) — nunca expõe o user_id/subscription_id cru como fonte adicional', async () => {
    const { client, builder } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    await repo.listTransactions({})

    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('profiles(name, email)'), { count: 'exact' })
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('subscriptions(stripe_subscription_id)'), { count: 'exact' })
  })

  it('sem filtros: nenhum .eq() é chamado, ordena por created_at DESC e usa range(offset, offset+limit-1)', async () => {
    const { client, builder, range } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    await repo.listTransactions({ limit: 10, offset: 20 })

    expect(builder.eq).not.toHaveBeenCalled()
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(range).toHaveBeenCalledWith(20, 29)
  })

  it('aplica statusFilter e currencyFilter via .eq() quando informados', async () => {
    const { client, builder } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    await repo.listTransactions({ statusFilter: 'failed', currencyFilter: 'USD' })

    expect(builder.eq).toHaveBeenCalledWith('status', 'failed')
    expect(builder.eq).toHaveBeenCalledWith('currency', 'USD')
  })

  it('mapeia todos os campos da linha, convertendo amount (string) para number e mascarando os 3 IDs Stripe', async () => {
    const { client } = mockClientForList([FULL_ROW])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    const result = await repo.listTransactions({})

    expect(result.totalCount).toBe(1)
    expect(result.transactions).toEqual([
      {
        id: 'txn-1',
        userId: 'user-1',
        userName: 'Thiago Teste',
        userEmail: 'thiago@example.com',
        amount: 29.9,
        currency: 'BRL',
        status: 'paid',
        createdAt: '2026-09-01T00:00:00.000Z',
        paidAt: '2026-09-01T00:05:00.000Z',
        stripeInvoiceId: 'in_1234567890abcdef',
        stripeInvoiceIdMasked: 'in_********cdef',
        stripePaymentIntentId: 'pi_1234567890abcdef',
        stripePaymentIntentIdMasked: 'pi_********cdef',
        stripeSubscriptionId: 'sub_1234567890abcdef',
        stripeSubscriptionIdMasked: 'sub_********cdef',
      },
    ])
  })

  it('IDs Stripe reais nunca são perdidos mesmo depois do masking (necessário para o href do Stripe Dashboard)', async () => {
    const { client } = mockClientForList([FULL_ROW])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    const [row] = (await repo.listTransactions({})).transactions

    expect(row.stripeInvoiceId).toBe('in_1234567890abcdef')
    expect(row.stripePaymentIntentId).toBe('pi_1234567890abcdef')
    expect(row.stripeSubscriptionId).toBe('sub_1234567890abcdef')
  })

  it('transação sem assinatura vinculada (subscriptions=null): stripeSubscriptionId fica null, mascarado vira "—" (nunca inventa uma assinatura)', async () => {
    const { client } = mockClientForList([{ ...FULL_ROW, subscriptions: null }])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    const [row] = (await repo.listTransactions({})).transactions

    expect(row.stripeSubscriptionId).toBeNull()
    expect(row.stripeSubscriptionIdMasked).toBe('—')
  })

  it('profiles null (defensivo): userName/userEmail ficam null em vez de lançar erro', async () => {
    const { client } = mockClientForList([{ ...FULL_ROW, profiles: null }])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    const [row] = (await repo.listTransactions({})).transactions

    expect(row.userName).toBeNull()
    expect(row.userEmail).toBeNull()
  })

  it('lista vazia: totalCount é 0 (nunca lança/undefined) e transactions é []', async () => {
    const { client } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    const result = await repo.listTransactions({})

    expect(result).toEqual({ transactions: [], totalCount: 0 })
  })

  it('amount inválido (não numérico) vira null em vez de NaN', async () => {
    const { client } = mockClientForList([{ ...FULL_ROW, amount: 'not-a-number' }])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    const [row] = (await repo.listTransactions({})).transactions

    expect(row.amount).toBeNull()
  })

  it('propaga erro da query sem mascarar', async () => {
    const { client } = mockClientForList([], 0, { message: 'permission denied' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminTransactionsRepository()
    await expect(repo.listTransactions({})).rejects.toThrow(/permission denied/)
  })
})
