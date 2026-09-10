/**
 * tests/unit/collection-item-limit-ux.test.ts
 * Etapa "5.9D — Paywall UX" — testa a camada de APLICAÇÃO por trás do
 * Paywall: `isPermissionError()` (reconciliação de UI desatualizada) e
 * `CollectionRepository.getItemLimit()` (mapeamento de
 * `check_collection_item_limit()` para `CollectionItemLimit`). O
 * enforcement real (RLS/trigger/concorrência) já foi provado
 * exaustivamente contra o banco em `tests/integration/collection-item-limit.test.ts`
 * (Etapa 5.9B) — não duplicado aqui.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { isPermissionError } from '@/lib/errors/get-user-friendly-error-message'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabaseCollectionRepository } = await import('@/features/collection/repositories/collection.repository')

describe('isPermissionError', () => {
  it('reconhece uma violação de RLS nativa do Postgres (mensagem)', () => {
    expect(isPermissionError(new Error('new row violates row-level security policy for table "collection_items"'))).toBe(true)
  })

  it('reconhece "permission denied for" (variante do Postgres)', () => {
    expect(isPermissionError(new Error('permission denied for table collection_items'))).toBe(true)
  })

  it('reconhece pelo CÓDIGO 42501 mesmo quando a mensagem é customizada (RAISE EXCEPTION do trigger de restore, Etapa 5.9A)', () => {
    const err = new Error('Limite de moedas ativas do plano atual foi atingido — não é possível restaurar esta moeda.') as Error & { code?: string }
    err.code = '42501'
    expect(isPermissionError(err)).toBe(true)
  })

  it('NUNCA reconhece um erro de rede/validação/genérico como permissão', () => {
    expect(isPermissionError(new Error('Failed to fetch'))).toBe(false)
    expect(isPermissionError(new Error('[CollectionRepository] Falha ao adicionar item: duplicate key value violates unique constraint'))).toBe(false)
    expect(isPermissionError(null)).toBe(false)
    expect(isPermissionError(undefined)).toBe(false)
  })

  it('não confunde um código de erro diferente (ex.: 23505, violação de unicidade) com permissão', () => {
    const err = new Error('duplicate key value') as Error & { code?: string }
    err.code = '23505'
    expect(isPermissionError(err)).toBe(false)
  })
})

describe('CollectionRepository.getItemLimit()', () => {
  function mockClient(row: { allowed: boolean; current_count: number; limit: number | null; plan_slug: string; is_unlimited: boolean } | null, error: { message: string } | null = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
    const rpc = vi.fn().mockReturnValue({ maybeSingle })
    return { rpc, from: vi.fn(), auth: { getUser: vi.fn() } } as unknown as SupabaseClient
  }

  it('mapeia o retorno da RPC (snake_case) para CollectionItemLimit (camelCase) — Free', async () => {
    const client = mockClient({ allowed: true, current_count: 49, limit: 50, plan_slug: 'free', is_unlimited: false })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseCollectionRepository()
    const result = await repo.getItemLimit()

    expect(result).toEqual({ allowed: true, currentCount: 49, limit: 50, planSlug: 'free', isUnlimited: false })
  })

  it('mapeia corretamente o caso ilimitado (Pro/Premium/courtesy) — limit=null', async () => {
    const client = mockClient({ allowed: true, current_count: 61, limit: null, plan_slug: 'pro', is_unlimited: true })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseCollectionRepository()
    const result = await repo.getItemLimit()

    expect(result).toEqual({ allowed: true, currentCount: 61, limit: null, planSlug: 'pro', isUnlimited: true })
  })

  it('fail-closed quando a RPC não devolve nenhuma linha (nunca assume ilimitado por omissão)', async () => {
    const client = mockClient(null)
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseCollectionRepository()
    const result = await repo.getItemLimit()

    expect(result.isUnlimited).toBe(false)
    expect(result.allowed).toBe(false)
  })

  it('propaga erro da RPC sem mascarar', async () => {
    const client = mockClient(null, { message: 'conexão perdida (simulado)' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseCollectionRepository()
    await expect(repo.getItemLimit()).rejects.toThrow(/conexão perdida/)
  })
})
