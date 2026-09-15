/**
 * tests/unit/plan-interest-repository.test.ts
 * Etapa "5.10S — Pro Interest / Pré-lançamento" — testa
 * `PlanInterestRepository` (features/billing/repositories/plan-interest.repository.ts)
 * com o Supabase client mockado (mesmo padrão de
 * tests/unit/collection-item-limit-ux.test.ts) — nunca a implementação
 * real, nunca rede. A garantia de RLS (usuário não lê/escreve o interesse
 * de outro, anon não insere) é responsabilidade de
 * tests/integration/plan-interest-rls.test.ts, contra Supabase DEV real —
 * não duplicada aqui.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabasePlanInterestRepository } = await import('@/features/billing/repositories/plan-interest.repository')

const FAKE_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function mockAuthenticatedClient(insertResult: { error: { code?: string; message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult)
  const from = vi.fn().mockReturnValue({ insert })
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: FAKE_USER_ID } }, error: null }) }
  return { client: { auth, from } as unknown as SupabaseClient, insert, from }
}

function mockStatusClient(row: { id: string } | null, error: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { auth: { getUser: vi.fn() }, from } as unknown as SupabaseClient, select, eq }
}

describe('PlanInterestRepository.register — A/B: primeiro registro por plano', () => {
  it('A) primeiro registro em "pro" chama insert com user_id resolvido da sessão (nunca do input) e plan_slug/source corretos', async () => {
    const { client, insert } = mockAuthenticatedClient({ error: null })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    const result = await repo.register({ planSlug: 'pro', source: 'collection_limit' })

    expect(result).toEqual({ registered: true })
    expect(insert).toHaveBeenCalledWith({ user_id: FAKE_USER_ID, plan_slug: 'pro', source: 'collection_limit' })
  })

  it('B) primeiro registro em "premium" funciona da mesma forma (nunca hardcoded "pro")', async () => {
    const { client, insert } = mockAuthenticatedClient({ error: null })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    const result = await repo.register({ planSlug: 'premium', source: 'pricing_page' })

    expect(result).toEqual({ registered: true })
    expect(insert).toHaveBeenCalledWith({ user_id: FAKE_USER_ID, plan_slug: 'premium', source: 'pricing_page' })
  })
})

describe('PlanInterestRepository.register — C: idempotência', () => {
  it('C) um segundo registro do mesmo plano (violação de unicidade 23505) NUNCA lança — devolve { registered: true } como sucesso', async () => {
    const { client } = mockAuthenticatedClient({ error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_plan_interest_user_plan"' } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    const result = await repo.register({ planSlug: 'pro', source: 'dashboard' })

    expect(result).toEqual({ registered: true })
  })

  it('um erro de banco que NÃO é 23505 continua propagando (nunca mascarado como idempotência)', async () => {
    const { client } = mockAuthenticatedClient({ error: { code: '08006', message: 'conexão perdida (simulado)' } })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    await expect(repo.register({ planSlug: 'pro', source: 'dashboard' })).rejects.toThrow(/conexão perdida/)
  })
})

describe('PlanInterestRepository.register — D: plano inválido', () => {
  it('D) plan_slug fora de pro/premium é rejeitado ANTES de qualquer chamada ao Supabase', async () => {
    const { client, from } = mockAuthenticatedClient({ error: null })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    await expect(repo.register({ planSlug: 'enterprise', source: 'dashboard' })).rejects.toThrow(/plan_slug inválido/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejeita string vazia', async () => {
    const { client } = mockAuthenticatedClient({ error: null })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    await expect(repo.register({ planSlug: '', source: null })).rejects.toThrow(/plan_slug inválido/)
  })
})

describe('PlanInterestRepository.register — sem sessão', () => {
  it('sem usuário logado, lança antes de tentar o insert', async () => {
    const insert = vi.fn()
    const from = vi.fn().mockReturnValue({ insert })
    const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) }
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ auth, from } as unknown as SupabaseClient)

    const repo = createSupabasePlanInterestRepository()
    await expect(repo.register({ planSlug: 'pro', source: null })).rejects.toThrow(/Nenhum usuário logado/)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('PlanInterestRepository.getStatus — L: estado ao abrir o diálogo', () => {
  it('devolve { registered: true } quando já existe uma linha para o plano', async () => {
    const { client, eq } = mockStatusClient({ id: 'row-1' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    const result = await repo.getStatus('pro')

    expect(result).toEqual({ registered: true })
    expect(eq).toHaveBeenCalledWith('plan_slug', 'pro')
  })

  it('devolve { registered: false } quando não há linha (maybeSingle → null)', async () => {
    const { client } = mockStatusClient(null)
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    const result = await repo.getStatus('premium')

    expect(result).toEqual({ registered: false })
  })

  it('propaga erro da consulta sem mascarar', async () => {
    const { client } = mockStatusClient(null, { message: 'conexão perdida (simulado)' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabasePlanInterestRepository()
    await expect(repo.getStatus('pro')).rejects.toThrow(/conexão perdida/)
  })
})
