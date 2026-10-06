/**
 * tests/unit/signup-cleanup-route.test.ts — Etapa "B2.5.7 (Bloco B)".
 * Exercita a ROTA REAL GET /api/internal/signup-cleanup (a que o Vercel Cron chamará) com o client
 * administrativo simulado: autenticação por Bearer (CRON_SECRET), método, e o escopo do que é excluído.
 * O escopo no banco real (confirmado, sem marcador, conta de análise, admin) está provado em
 * tests/integration/signup-server-flow.test.ts; aqui, a mesma regra pela rota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

interface FakeUser {
  id: string
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  app_metadata: Record<string, unknown>
}

const SECRET = 'cron-secret-do-not-leak-0123456789'
const PUBLIC_FLOW = { signup_flow: 'public_v1', signup_attempt_nonce: 'nonce-of-the-creating-request', signup_state: 'ready' }

const users = new Map<string, FakeUser>()
let staleIds: string[] = []
let rpcError: { message: string } | null = null

const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: Array<{ user_id: string }> | null; error: { message: string } | null }>>(
  async () => ({
    data: rpcError ? null : staleIds.map((user_id) => ({ user_id })),
    error: rpcError,
  }),
)
const getUserById = vi.fn(async (id: string) =>
  users.has(id) ? { data: { user: users.get(id) }, error: null } : { data: { user: null }, error: { status: 404 } },
)
const deleteUser = vi.fn<(id: string) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }))
const getSupabaseAdminClient = vi.fn(() => ({ rpc, auth: { admin: { getUserById, deleteUser } } }))

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdminClient: () => getSupabaseAdminClient() }))

import * as routeModule from '@/app/api/internal/signup-cleanup/route'

const { GET } = routeModule
const URL_BASE = 'https://www.numoracollect.com/api/internal/signup-cleanup'
const call = (headers: Record<string, string> = {}, url = URL_BASE) => GET(new Request(url, { method: 'GET', headers }))
const bearer = (value = SECRET) => ({ authorization: `Bearer ${value}` })

function pending(id: string, overrides: Partial<FakeUser> = {}): FakeUser {
  const user = { id, email_confirmed_at: null, last_sign_in_at: null, app_metadata: { ...PUBLIC_FLOW }, ...overrides }
  users.set(id, user)
  return user
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET)
  users.clear()
  staleIds = []
  rpcError = null
  for (const fn of [rpc, getUserById, deleteUser, getSupabaseAdminClient, captureException]) fn.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('autenticação — sempre Bearer <CRON_SECRET>, nunca acesso anônimo', () => {
  it('sem Authorization → 401, sem tocar o banco', async () => {
    const response = await call()
    expect(response.status).toBe(401)
    expect(getSupabaseAdminClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['Bearer incorreto (mesmo tamanho)', `Bearer ${'x'.repeat(SECRET.length)}`],
    ['Bearer incorreto (tamanho diferente)', 'Bearer curto'],
    ['Bearer vazio', 'Bearer '],
    ['esquema errado (Basic)', `Basic ${SECRET}`],
    ['segredo sem o prefixo Bearer', SECRET],
    ['minúsculas no esquema', `bearer ${SECRET}`],
  ])('%s → 401, sem tocar o banco', async (_label, authorization) => {
    const response = await call({ authorization })
    expect(response.status).toBe(401)
    expect(getSupabaseAdminClient).not.toHaveBeenCalled()
  })

  it('o segredo na query string NÃO autentica', async () => {
    const response = await call({}, `${URL_BASE}?secret=${SECRET}&token=${SECRET}&authorization=Bearer%20${SECRET}`)
    expect(response.status).toBe(401)
    expect(getSupabaseAdminClient).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '   '])('CRON_SECRET ausente/vazio (%j) → 404 fail-closed, mesmo com um Bearer qualquer', async (value) => {
    vi.stubEnv('CRON_SECRET', value as string)
    const response = await call(bearer('qualquer-coisa'))
    expect(response.status).toBe(404)
    expect(getSupabaseAdminClient).not.toHaveBeenCalled()
  })

  it('a resposta de rejeição nunca contém o segredo', async () => {
    const response = await call({ authorization: 'Bearer errado' })
    expect(await response.text()).not.toContain(SECRET)
  })
})

describe('método — só GET (o único que o Vercel Cron usa)', () => {
  it('a rota exporta GET e nenhum outro método HTTP (POST/PUT/PATCH/DELETE/HEAD/OPTIONS → 405 do Next)', () => {
    const methods = Object.keys(routeModule).filter((key) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(key))
    expect(methods).toEqual(['GET'])
  })
})

describe('Bearer correto → executa o cleanup', () => {
  it('lista pelo RPC existente (corte = agora − 7 dias, lote 100), responde ok sem cache e sem vazar o segredo', async () => {
    const before = Date.now()
    const response = await call(bearer())
    const after = Date.now()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { ok: boolean; cutoff: string; candidates: number; deleted: number; skipped: number; failed: number }
    expect(body).toMatchObject({ ok: true, candidates: 0, deleted: 0, skipped: 0, failed: 0 })
    expect(JSON.stringify(body)).not.toContain(SECRET)

    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('list_stale_pending_public_signups')
    expect(args.p_limit).toBe(100)
    const cutoff = Date.parse(args.p_cutoff as string)
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(cutoff).toBeGreaterThanOrEqual(before - sevenDays)
    expect(cutoff).toBeLessThanOrEqual(after - sevenDays)
  })

  it('exclui SOMENTE o pendente do fluxo público listado pelo RPC; confirmado, já logado, sem marcador (admin/conta de análise) e inexistente são preservados', async () => {
    pending('public-pending')
    pending('confirmed', { email_confirmed_at: '2026-09-01T00:00:00Z' })
    pending('signed-in', { last_sign_in_at: '2026-09-02T00:00:00Z' })
    pending('admin-like', { app_metadata: { role: 'admin' } }) // sem marcador do fluxo público
    pending('analysis-account-like', { app_metadata: { internal_test: true } }) // idem
    pending('forged-marker-without-nonce', { app_metadata: { signup_flow: 'public_v1' } }) // marcador sem nonce não prova origem
    staleIds = ['public-pending', 'confirmed', 'signed-in', 'admin-like', 'analysis-account-like', 'forged-marker-without-nonce', 'already-gone']

    const response = await call(bearer())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, candidates: 7, deleted: 1, skipped: 6, failed: 0 })
    expect(deleteUser).toHaveBeenCalledTimes(1)
    expect(deleteUser).toHaveBeenCalledWith('public-pending')
  })

  it('só considera quem o RPC listou: um pendente público elegível que o RPC NÃO listou nunca é tocado', async () => {
    pending('listed')
    pending('not-listed')
    staleIds = ['listed']

    await call(bearer())
    expect(deleteUser.mock.calls.map((c) => c[0])).toEqual(['listed'])
    expect(getUserById.mock.calls.map((c) => c[0])).toEqual(['listed'])
  })

  it('revalida cada usuário antes de excluir: confirmado entre a listagem e a exclusão fica intacto', async () => {
    pending('raced')
    staleIds = ['raced']
    // A confirmação chega depois da listagem, antes da releitura.
    getUserById.mockImplementationOnce(async (id: string) => ({ data: { user: { ...(users.get(id) as FakeUser), email_confirmed_at: '2026-10-03T00:00:00Z' } }, error: null }))

    expect(await (await call(bearer())).json()).toMatchObject({ deleted: 0, skipped: 1 })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('idempotente: depois de limpar, uma segunda execução (RPC sem candidatos) não exclui nada', async () => {
    pending('once')
    staleIds = ['once']
    await call(bearer())
    expect(deleteUser).toHaveBeenCalledTimes(1)

    staleIds = []
    deleteUser.mockClear()
    expect(await (await call(bearer())).json()).toMatchObject({ ok: true, candidates: 0, deleted: 0 })
    expect(deleteUser).not.toHaveBeenCalled()
  })
})

describe('falhas — nada é excluído e nada sensível sai', () => {
  it('RPC com erro → 500 genérico (sem mensagem do banco nem segredo), nenhuma exclusão, erro ao Sentry sem o segredo', async () => {
    rpcError = { message: `permission denied for ${SECRET}` }
    const response = await call(bearer())

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ ok: false })
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('permission denied')
    expect(deleteUser).not.toHaveBeenCalled()

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(captureException.mock.calls)).not.toContain(SECRET)
    expect(captureException.mock.calls[0][1].tags.auth_context).toBe('signup_cleanup')
  })

  it('falha ao excluir um usuário não interrompe os demais e é contada', async () => {
    pending('a')
    pending('b')
    staleIds = ['a', 'b']
    deleteUser.mockImplementationOnce(async () => ({ error: { message: "boom" } }))

    expect(await (await call(bearer())).json()).toMatchObject({ ok: true, candidates: 2, deleted: 1, failed: 1 })
    expect(deleteUser).toHaveBeenCalledTimes(2)
  })
})
