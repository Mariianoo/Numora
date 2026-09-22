/**
 * tests/unit/admin-subscriptions-repository.test.ts
 * Etapa "Admin Subscriptions V1" — testa
 * `AdminSubscriptionsRepository` (features/billing/repositories/admin-subscriptions.repository.ts)
 * com o Supabase client mockado, mesmo padrão de
 * tests/unit/analysis-account-repository.test.ts. Nunca a implementação
 * real, nunca rede — a garantia de autorização/RLS real já está coberta por
 * tests/integration/admin-subscriptions.test.ts. Este arquivo cobre que o
 * repository chama a RPC certa, com os parâmetros certos, mapeia
 * corretamente os campos (incluindo masking de IDs Stripe) e nunca
 * reimplementa nenhuma regra em TypeScript.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabaseAdminSubscriptionsRepository } = await import('@/features/billing/repositories/admin-subscriptions.repository')

const FULL_ROW = {
  subscription_id: 'sub-row-1',
  user_id: 'user-1',
  user_name: 'Thiago Teste',
  user_email: 'thiago@example.com',
  plan_slug: 'pro',
  status: 'active',
  interval: 'month',
  currency: 'BRL',
  amount: '29.9',
  created_at: '2026-09-01T00:00:00.000Z',
  current_period_start: '2026-09-22T00:00:00.000Z',
  current_period_end: '2026-10-22T00:00:00.000Z',
  cancel_at_period_end: false,
  canceled_at: null,
  trial_end: null,
  scheduled_plan_slug: null,
  stripe_customer_id: 'cus_1234567890abcdef',
  stripe_subscription_id: 'sub_1234567890abcdef',
  last_transaction_status: 'paid',
  last_transaction_paid_at: '2026-09-22T00:00:00.000Z',
  total_count: 1,
}

function mockClientForList(rows: unknown[]) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

function mockClientForListError(message: string) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

function mockClientForSummary(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const rpc = vi.fn().mockReturnValue({ maybeSingle })
  return { client: { rpc } as unknown as SupabaseClient, rpc, maybeSingle }
}

describe('AdminSubscriptionsRepository.listSubscriptions()', () => {
  it('chama admin_list_subscriptions com os parâmetros padrão quando nenhum filtro é passado', async () => {
    const { client, rpc } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    await repo.listSubscriptions({})

    expect(rpc).toHaveBeenCalledWith('admin_list_subscriptions', {
      p_limit: 50,
      p_offset: 0,
      p_status_filter: null,
      p_plan_filter: null,
      p_currency_filter: null,
      p_cancel_scheduled_only: false,
      p_search: null,
    })
  })

  it('repassa limit/offset/filtros exatamente como recebidos', async () => {
    const { client, rpc } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    await repo.listSubscriptions({
      limit: 10,
      offset: 20,
      statusFilter: 'active',
      planFilter: 'premium',
      currencyFilter: 'USD',
      cancelScheduledOnly: true,
      search: '  ana  ',
    })

    expect(rpc).toHaveBeenCalledWith('admin_list_subscriptions', {
      p_limit: 10,
      p_offset: 20,
      p_status_filter: 'active',
      p_plan_filter: 'premium',
      p_currency_filter: 'USD',
      p_cancel_scheduled_only: true,
      p_search: 'ana',
    })
  })

  it('busca vazia/só espaços vira null (nunca uma string vazia é enviada à RPC)', async () => {
    const { client, rpc } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    await repo.listSubscriptions({ search: '   ' })

    expect(rpc).toHaveBeenCalledWith('admin_list_subscriptions', expect.objectContaining({ p_search: null }))
  })

  it('mapeia todos os campos da linha, convertendo amount (string) para number e mascarando os IDs Stripe', async () => {
    const { client } = mockClientForList([FULL_ROW])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const result = await repo.listSubscriptions({})

    expect(result.totalCount).toBe(1)
    expect(result.subscriptions).toEqual([
      {
        subscriptionId: 'sub-row-1',
        userId: 'user-1',
        userName: 'Thiago Teste',
        userEmail: 'thiago@example.com',
        planSlug: 'pro',
        status: 'active',
        interval: 'month',
        currency: 'BRL',
        amount: 29.9,
        createdAt: '2026-09-01T00:00:00.000Z',
        currentPeriodStart: '2026-09-22T00:00:00.000Z',
        currentPeriodEnd: '2026-10-22T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEnd: null,
        scheduledPlanSlug: null,
        stripeCustomerId: 'cus_1234567890abcdef',
        stripeCustomerIdMasked: 'cus_********cdef',
        stripeSubscriptionId: 'sub_1234567890abcdef',
        stripeSubscriptionIdMasked: 'sub_********cdef',
        lastTransactionStatus: 'paid',
        lastTransactionPaidAt: '2026-09-22T00:00:00.000Z',
      },
    ])
  })

  it('IDs Stripe reais nunca são perdidos mesmo depois do masking (necessário para o href do Stripe Dashboard)', async () => {
    const { client } = mockClientForList([FULL_ROW])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const [row] = (await repo.listSubscriptions({})).subscriptions

    expect(row.stripeCustomerId).toBe('cus_1234567890abcdef')
    expect(row.stripeSubscriptionId).toBe('sub_1234567890abcdef')
  })

  it('lista vazia: totalCount é 0 (nunca lança/undefined) e subscriptions é []', async () => {
    const { client } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const result = await repo.listSubscriptions({})

    expect(result).toEqual({ subscriptions: [], totalCount: 0 })
  })

  it('campos null (stripe_customer_id, trial_end, last_transaction_*, scheduled_plan_slug) são tratados sem lançar erro', async () => {
    const { client } = mockClientForList([
      { ...FULL_ROW, stripe_customer_id: null, trial_end: null, last_transaction_status: null, last_transaction_paid_at: null, scheduled_plan_slug: null },
    ])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const [row] = (await repo.listSubscriptions({})).subscriptions

    expect(row.stripeCustomerId).toBeNull()
    expect(row.stripeCustomerIdMasked).toBe('—')
    expect(row.trialEnd).toBeNull()
    expect(row.lastTransactionStatus).toBeNull()
    expect(row.scheduledPlanSlug).toBeNull()
  })

  it('amount inválido (não numérico) vira null em vez de NaN', async () => {
    const { client } = mockClientForList([{ ...FULL_ROW, amount: 'not-a-number' }])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const [row] = (await repo.listSubscriptions({})).subscriptions

    expect(row.amount).toBeNull()
  })

  it('propaga erro da RPC sem mascarar', async () => {
    const { client } = mockClientForListError('permission denied')
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    await expect(repo.listSubscriptions({})).rejects.toThrow(/permission denied/)
  })
})

describe('AdminSubscriptionsRepository.getSummary()', () => {
  it('chama admin_subscriptions_summary e mapeia os 4 campos', async () => {
    const { client, rpc } = mockClientForSummary({
      total_subscriptions: 10,
      active_subscriptions: 7,
      canceling_subscriptions: 2,
      failed_payment_subscriptions: 1,
    })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const summary = await repo.getSummary()

    expect(rpc).toHaveBeenCalledWith('admin_subscriptions_summary')
    expect(summary).toEqual({
      totalSubscriptions: 10,
      activeSubscriptions: 7,
      cancelingSubscriptions: 2,
      failedPaymentSubscriptions: 1,
    })
  })

  it('data null (nenhuma linha) vira todos os campos 0, nunca undefined/lançar erro', async () => {
    const { client } = mockClientForSummary(null)
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    const summary = await repo.getSummary()

    expect(summary).toEqual({
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      cancelingSubscriptions: 0,
      failedPaymentSubscriptions: 0,
    })
  })

  it('propaga erro da RPC sem mascarar', async () => {
    const { client } = mockClientForSummary(null, { message: 'falha simulada' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminSubscriptionsRepository()
    await expect(repo.getSummary()).rejects.toThrow(/falha simulada/)
  })
})
