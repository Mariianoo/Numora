/**
 * tests/unit/export-entitlement-repository.test.ts
 * Etapa "5.10U — Exportação da Coleção" — testa
 * `ExportEntitlementRepository.isEnabled()` com o Supabase client mockado
 * (mesmo padrão de tests/unit/collection-item-limit-ux.test.ts) — nunca a
 * implementação real, nunca rede. Cobre Free bloqueado / Pro permitido /
 * Premium permitido através do MESMO contrato (`get_my_entitlement`), que é
 * quem realmente decide `enabled` por plano (esta suíte nunca duplica essa
 * decisão de negócio, só confirma que o repository repassa a resposta
 * corretamente).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabaseExportEntitlementRepository } = await import(
  '@/features/collection/repositories/export-entitlement.repository'
)

function mockClient(row: { enabled: boolean } | null, error: { message: string } | null = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error })
  const rpc = vi.fn().mockReturnValue({ single })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('ExportEntitlementRepository.isEnabled()', () => {
  it('Free (enabled=false) — bloqueado', async () => {
    const { client } = mockClient({ enabled: false })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseExportEntitlementRepository()
    await expect(repo.isEnabled()).resolves.toBe(false)
  })

  it('Pro (enabled=true) — permitido', async () => {
    const { client } = mockClient({ enabled: true })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseExportEntitlementRepository()
    await expect(repo.isEnabled()).resolves.toBe(true)
  })

  it('Premium (enabled=true) — permitido (mesmo contrato de Pro, nenhuma lógica paralela por plano)', async () => {
    const { client } = mockClient({ enabled: true })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseExportEntitlementRepository()
    await expect(repo.isEnabled()).resolves.toBe(true)
  })

  it('chama exatamente get_my_entitlement com p_feature_key="exports" — nenhuma RPC nova, nenhum outro feature_key', async () => {
    const { client, rpc } = mockClient({ enabled: true })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    await createSupabaseExportEntitlementRepository().isEnabled()

    expect(rpc).toHaveBeenCalledWith('get_my_entitlement', { p_feature_key: 'exports' })
  })

  it('fail-closed: nenhuma linha devolvida (nunca assume habilitado por omissão)', async () => {
    const { client } = mockClient(null)
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseExportEntitlementRepository()
    await expect(repo.isEnabled()).resolves.toBe(false)
  })

  it('propaga erro da RPC sem mascarar (nunca engolido como "false" silencioso)', async () => {
    const { client } = mockClient(null, { message: 'conexão perdida (simulado)' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseExportEntitlementRepository()
    await expect(repo.isEnabled()).rejects.toThrow(/conexão perdida/)
  })
})
