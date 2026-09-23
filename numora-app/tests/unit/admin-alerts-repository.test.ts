/**
 * tests/unit/admin-alerts-repository.test.ts
 * Etapa "Admin Alerts V1" — testa `AdminAlertsRepository`
 * (features/admin/repositories/admin-alerts.repository.ts) com o Supabase
 * client mockado, mesmo padrão de tests/unit/admin-transactions-repository.test.ts
 * (query direta, sem RPC). `Date` é congelada via `vi.useFakeTimers()` para
 * provar exatamente a janela de 7 dias, sem depender do relógio real da
 * máquina que roda o teste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const { getSupabaseBrowserClient } = await import('@/lib/supabase/client')
const { createSupabaseAdminAlertsRepository, isCriticalUnresolvedFeedback } = await import(
  '@/features/admin/repositories/admin-alerts.repository'
)

const FULL_ROW = {
  id: 'grant-1',
  user_id: 'user-1',
  type: 'courtesy',
  plan: 'pro',
  reason: 'Beta tester',
  starts_at: '2026-09-01T00:00:00.000Z',
  expires_at: '2026-09-25T00:00:00.000Z',
  created_by: 'owner-1',
  created_at: '2026-09-01T00:00:00.000Z',
  revoked_at: null,
  profiles: { name: 'Thiago Teste', email: 'thiago@example.com' },
}

/** Builder self-referencial: `.select()`/`.is()`/`.gte()`/`.lte()` devolvem o mesmo objeto, `.order()` é a chamada terminal que resolve a Promise (mesmo espírito de admin-transactions-repository.test.ts, adaptado à cadeia real deste repository). */
function mockClientForList(rows: unknown[], error: { message: string } | null = null) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn().mockReturnValue(builder)
  builder.is = vi.fn().mockReturnValue(builder)
  builder.gte = vi.fn().mockReturnValue(builder)
  builder.lte = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockResolvedValue({ data: error ? null : rows, error })
  const from = vi.fn().mockReturnValue(builder)
  return { client: { from } as unknown as SupabaseClient, from, builder }
}

describe('AdminAlertsRepository.listExpiringBenefitGrants()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('consulta a tabela benefit_grants (nunca uma RPC)', async () => {
    const { client, from } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    await repo.listExpiringBenefitGrants()

    expect(from).toHaveBeenCalledWith('benefit_grants')
  })

  it('filtra revoked_at IS NULL (regra exata da auditoria)', async () => {
    const { client, builder } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    await repo.listExpiringBenefitGrants()

    expect(builder.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('a janela é EXATAMENTE [agora, agora + 7 dias] — provado com o relógio congelado', async () => {
    const { client, builder } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    await repo.listExpiringBenefitGrants()

    expect(builder.gte).toHaveBeenCalledWith('expires_at', '2026-09-23T12:00:00.000Z')
    expect(builder.lte).toHaveBeenCalledWith('expires_at', '2026-09-30T12:00:00.000Z')
  })

  it('ordena pela expiração mais próxima primeiro', async () => {
    const { client, builder } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    await repo.listExpiringBenefitGrants()

    expect(builder.order).toHaveBeenCalledWith('expires_at', { ascending: true })
  })

  it('embute profiles(name,email) e mapeia userName/userEmail corretamente', async () => {
    const { client } = mockClientForList([FULL_ROW])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    const [grant] = await repo.listExpiringBenefitGrants()

    expect(grant).toEqual({
      id: 'grant-1',
      userId: 'user-1',
      type: 'courtesy',
      plan: 'pro',
      reason: 'Beta tester',
      startsAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-25T00:00:00.000Z',
      createdBy: 'owner-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      revokedAt: null,
      userName: 'Thiago Teste',
      userEmail: 'thiago@example.com',
    })
  })

  it('profiles null (defensivo): userName/userEmail ficam null em vez de lançar erro', async () => {
    const { client } = mockClientForList([{ ...FULL_ROW, profiles: null }])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    const [grant] = await repo.listExpiringBenefitGrants()

    expect(grant.userName).toBeNull()
    expect(grant.userEmail).toBeNull()
  })

  it('lista vazia: nunca lança, devolve []', async () => {
    const { client } = mockClientForList([])
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    const result = await repo.listExpiringBenefitGrants()

    expect(result).toEqual([])
  })

  it('propaga erro da query sem mascarar', async () => {
    const { client } = mockClientForList([], { message: 'permission denied' })
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(client)

    const repo = createSupabaseAdminAlertsRepository()
    await expect(repo.listExpiringBenefitGrants()).rejects.toThrow(/permission denied/)
  })
})

describe('isCriticalUnresolvedFeedback() — regra exata da auditoria', () => {
  it('critical + new entra', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'critical', status: 'new' })).toBe(true)
  })

  it('critical + reviewing entra', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'critical', status: 'reviewing' })).toBe(true)
  })

  it('critical + planned entra', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'critical', status: 'planned' })).toBe(true)
  })

  it('critical + in_progress entra', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'critical', status: 'in_progress' })).toBe(true)
  })

  it('critical + completed EXCLUI', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'critical', status: 'completed' })).toBe(false)
  })

  it('critical + dismissed EXCLUI', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'critical', status: 'dismissed' })).toBe(false)
  })

  it('prioridade não crítica (low/medium/high) EXCLUI, mesmo com status não resolvido', () => {
    expect(isCriticalUnresolvedFeedback({ priority: 'low', status: 'new' })).toBe(false)
    expect(isCriticalUnresolvedFeedback({ priority: 'medium', status: 'new' })).toBe(false)
    expect(isCriticalUnresolvedFeedback({ priority: 'high', status: 'new' })).toBe(false)
  })
})
