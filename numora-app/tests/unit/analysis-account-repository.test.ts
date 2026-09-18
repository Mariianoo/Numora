/**
 * tests/unit/analysis-account-repository.test.ts
 * Etapa "5.10W.4 — Conta de Análise: Painel Administrativo" — testa
 * `AnalysisAccountRepository` (features/admin/repositories/analysis-account.repository.ts)
 * com o Supabase client mockado (mesmo padrão de
 * tests/unit/collection-item-limit-ux.test.ts) — nunca a implementação
 * real, nunca rede. A garantia de autorização/RLS das RPCs reais já está
 * coberta por tests/integration/analysis-account-plan-switch.test.ts e
 * tests/integration/analysis-account-dataset.test.ts — este arquivo cobre
 * só que o repository chama a RPC CERTA, com o parâmetro certo, e nunca
 * reimplementa nenhuma regra em TypeScript.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabaseAnalysisAccountRepository } = await import('@/features/admin/repositories/analysis-account.repository')

const ANALYSIS_ACCOUNT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

/** Thenable + `.single()`/`.maybeSingle()` — mesmo objeto serve tanto para `await supabase.rpc(...)` direto quanto para `.single()`/`.maybeSingle()` encadeado, como o supabase-js real permite. */
function rpcResult(data: unknown, error: unknown = null) {
  const result = { data, error }
  return {
    then: (resolve: (value: typeof result) => void) => resolve(result),
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  }
}

interface MockOptions {
  markerUserId?: string | null
  markerError?: { message: string } | null
  planData?: { plan_slug: string } | null
  planError?: { message: string } | null
  summaryData?: { item_count: number; country_count: number; purchase_count: number } | null
  summaryError?: { message: string } | null
  switchError?: { message: string } | null
  populateData?: { populated: boolean; item_count: number } | null
  populateError?: { message: string } | null
  resetError?: { message: string } | null
}

function mockClient(options: MockOptions = {}) {
  const maybeSingleMarker = vi.fn().mockResolvedValue({
    data: options.markerUserId !== undefined && options.markerUserId !== null ? { user_id: options.markerUserId } : null,
    error: options.markerError ?? null,
  })
  const limitMarker = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMarker })
  const selectMarker = vi.fn().mockReturnValue({ limit: limitMarker })
  const from = vi.fn().mockReturnValue({ select: selectMarker })

  const rpc = vi.fn((name: string) => {
    switch (name) {
      case 'get_effective_plan':
        return rpcResult(options.planData ?? null, options.planError ?? null)
      case 'get_analysis_account_dataset_summary':
        return rpcResult(options.summaryData ?? null, options.summaryError ?? null)
      case 'switch_analysis_account_plan':
        return rpcResult(null, options.switchError ?? null)
      case 'populate_analysis_account_dataset':
        return rpcResult(options.populateData ?? null, options.populateError ?? null)
      case 'reset_analysis_account_dataset':
        return rpcResult(null, options.resetError ?? null)
      default:
        throw new Error(`[test] RPC inesperada: ${name}`)
    }
  })

  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc }
}

describe('AnalysisAccountRepository.getState()', () => {
  it('nenhuma Conta de Análise configurada (internal_test_accounts vazia) — devolve null', async () => {
    const { client } = mockClient({ markerUserId: null })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.getState()).resolves.toBeNull()
  })

  it('Conta de Análise configurada — combina get_effective_plan + get_analysis_account_dataset_summary para o MESMO user_id', async () => {
    const { client, rpc } = mockClient({
      markerUserId: ANALYSIS_ACCOUNT_ID,
      planData: { plan_slug: 'pro' },
      summaryData: { item_count: 35, country_count: 15, purchase_count: 30 },
    })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    const state = await repo.getState()

    expect(state).toEqual({
      userId: ANALYSIS_ACCOUNT_ID,
      planSlug: 'pro',
      itemCount: 35,
      countryCount: 15,
      purchaseCount: 30,
    })
    expect(rpc).toHaveBeenCalledWith('get_effective_plan', { p_user_id: ANALYSIS_ACCOUNT_ID })
    expect(rpc).toHaveBeenCalledWith('get_analysis_account_dataset_summary', { p_user_id: ANALYSIS_ACCOUNT_ID })
  })

  it('propaga erro do plano sem mascarar', async () => {
    const { client } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID, planError: { message: 'falha simulada' } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.getState()).rejects.toThrow(/falha simulada/)
  })

  it('propaga erro do dataset sem mascarar', async () => {
    const { client } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID, planData: { plan_slug: 'free' }, summaryError: { message: 'falha simulada' } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.getState()).rejects.toThrow(/falha simulada/)
  })
})

describe('AnalysisAccountRepository.switchPlan()', () => {
  it('chama switch_analysis_account_plan com o user_id da Conta de Análise e o plano pedido — nunca escreve em benefit_grants diretamente', async () => {
    const { client, rpc } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await repo.switchPlan('premium')

    expect(rpc).toHaveBeenCalledWith('switch_analysis_account_plan', { p_user_id: ANALYSIS_ACCOUNT_ID, p_plan: 'premium' })
  })

  it('sem Conta de Análise configurada, lança ANTES de chamar qualquer RPC', async () => {
    const { client, rpc } = mockClient({ markerUserId: null })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.switchPlan('pro')).rejects.toThrow(/Nenhuma Conta de Análise configurada/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('propaga erro da RPC sem mascarar', async () => {
    const { client } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID, switchError: { message: 'Somente o owner pode alterar o plano da Conta de Análise.' } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.switchPlan('pro')).rejects.toThrow(/Somente o owner pode/)
  })
})

describe('AnalysisAccountRepository.populateDataset()', () => {
  it('chama populate_analysis_account_dataset e repassa o resultado (populated/itemCount)', async () => {
    const { client, rpc } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID, populateData: { populated: true, item_count: 35 } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    const result = await repo.populateDataset()

    expect(result).toEqual({ populated: true, itemCount: 35 })
    expect(rpc).toHaveBeenCalledWith('populate_analysis_account_dataset', { p_user_id: ANALYSIS_ACCOUNT_ID })
  })

  it('já populado (idempotente): repassa populated=false sem lançar erro', async () => {
    const { client } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID, populateData: { populated: false, item_count: 35 } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.populateDataset()).resolves.toEqual({ populated: false, itemCount: 35 })
  })
})

describe('AnalysisAccountRepository.resetDataset()', () => {
  it('chama reset_analysis_account_dataset com o user_id da Conta de Análise — nunca um DELETE direto', async () => {
    const { client, rpc, from } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await repo.resetDataset()

    expect(rpc).toHaveBeenCalledWith('reset_analysis_account_dataset', { p_user_id: ANALYSIS_ACCOUNT_ID })
    // `from` só é usado para localizar a Conta de Análise (internal_test_accounts) — nunca para um `.delete()`.
    expect(from).toHaveBeenCalledWith('internal_test_accounts')
    expect(from).not.toHaveBeenCalledWith('collection_items')
    expect(from).not.toHaveBeenCalledWith('purchases')
  })

  it('propaga erro da RPC sem mascarar', async () => {
    const { client } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID, resetError: { message: 'falha simulada' } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await expect(repo.resetDataset()).rejects.toThrow(/falha simulada/)
  })
})

describe('AnalysisAccountRepository — nenhum user_id/e-mail hardcoded', () => {
  it('findAnalysisAccountUserId sempre consulta internal_test_accounts — nunca um valor fixo', async () => {
    const { client, from } = mockClient({ markerUserId: ANALYSIS_ACCOUNT_ID })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAnalysisAccountRepository()
    await repo.getState()

    expect(from).toHaveBeenCalledWith('internal_test_accounts')
  })
})
