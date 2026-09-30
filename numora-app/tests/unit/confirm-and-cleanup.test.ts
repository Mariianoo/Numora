/**
 * tests/unit/confirm-and-cleanup.test.ts — Etapa "B2.4 — Signup server-controlled".
 * Confirmação do e-mail (POST /api/auth/confirm) e limpeza de cadastros
 * pendentes (7 dias), com portas simuladas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

import { CONFIRM_INVALID_PATH, CONFIRM_UNAVAILABLE_PATH, SET_PASSWORD_PATH, handleConfirmRequest, type ConfirmDeps, type VerifyOtpOutcome } from '@/lib/auth/confirm-signup'
import { CLEANUP_BATCH_SIZE, PENDING_SIGNUP_RETENTION_DAYS, cleanupPendingSignups, type CleanupUserInfo, type PendingSignupCleanupPorts } from '@/lib/auth/pending-signup-cleanup'

const ORIGIN = 'https://www.numoracollect.com'
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

function form(fields: Record<string, string>, options: { origin?: string | null; contentType?: string } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': options.contentType ?? 'application/x-www-form-urlencoded' }
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN
  return new Request(`${ORIGIN}/api/auth/confirm`, { method: 'POST', headers, body: new URLSearchParams(fields).toString() })
}

function makeDeps(outcome: VerifyOtpOutcome | (() => Promise<VerifyOtpOutcome>) = { ok: true, userId: 'u1' }, extra: Partial<ConfirmDeps> = {}) {
  const verifyOtp = vi.fn(typeof outcome === 'function' ? outcome : async () => outcome)
  const deps: ConfirmDeps = { env: { NEXT_PUBLIC_SITE_URL: ORIGIN }, verifyOtp, requestId: 'req-1', ...extra }
  return { deps, verifyOtp }
}

beforeEach(() => captureException.mockReset())

describe('POST /api/auth/confirm — sucesso', () => {
  it('consome o token com type=signup e redireciona (303) para /auth/set-password na origem canônica', async () => {
    const { deps, verifyOtp } = makeDeps()
    const result = await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }), deps)

    expect(result).toEqual({ kind: 'redirect', location: `${ORIGIN}${SET_PASSWORD_PATH}`, status: 303 })
    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(verifyOtp).toHaveBeenCalledWith(TOKEN)
  })

  it('aceita JSON além de formulário', async () => {
    const { deps, verifyOtp } = makeDeps()
    const request = new Request(`${ORIGIN}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ token_hash: TOKEN, type: 'signup' }),
    })
    expect((await handleConfirmRequest(request, deps)).kind).toBe('redirect')
    expect(verifyOtp).toHaveBeenCalledWith(TOKEN)
  })

  it('efeitos pós-confirmação (atribuição) rodam, mas uma falha deles NUNCA bloqueia a confirmação', async () => {
    const afterConfirm = vi.fn().mockRejectedValue(new Error('rede'))
    const { deps } = makeDeps({ ok: true, userId: 'u1' }, { afterConfirm })
    const result = await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }), deps)
    expect(afterConfirm).toHaveBeenCalledWith('u1')
    expect(result).toMatchObject({ kind: 'redirect', location: `${ORIGIN}${SET_PASSWORD_PATH}` })
    expect(captureException).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/auth/confirm — token inválido/expirado/reutilizado (mensagem neutra)', () => {
  it.each(['invalid', 'unavailable'] as const)('verifyOtp %s → redirect fixo neutro, sem detalhe interno', async (kind) => {
    const { deps } = makeDeps({ ok: false, kind })
    const result = await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }), deps)
    const expected = kind === 'invalid' ? CONFIRM_INVALID_PATH : CONFIRM_UNAVAILABLE_PATH
    expect(result).toEqual({ kind: 'redirect', location: `${ORIGIN}${expected}`, status: 303 })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('a resposta não distingue expirado de usado de inexistente (mesmo redirect)', async () => {
    const a = await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }), makeDeps({ ok: false, kind: 'invalid' }).deps)
    const b = await handleConfirmRequest(form({ token_hash: 'zzzzzzzzzzzzzz', type: 'signup' }), makeDeps({ ok: false, kind: 'invalid' }).deps)
    expect(a).toEqual(b)
  })

  it.each([
    ['sem token', { type: 'signup' }],
    ['sem type', { token_hash: TOKEN }],
    ['type diferente de signup (recovery)', { token_hash: TOKEN, type: 'recovery' }],
    ['type magiclink', { token_hash: TOKEN, type: 'magiclink' }],
    ['token curto', { token_hash: 'abc', type: 'signup' }],
    ['token com caracteres inválidos', { token_hash: "abc'; drop table--", type: 'signup' }],
    ['token gigante', { token_hash: 'a'.repeat(600), type: 'signup' }],
  ])('%s → redirect neutro SEM chamar verifyOtp', async (_label, fields) => {
    const { deps, verifyOtp } = makeDeps()
    const result = await handleConfirmRequest(form(fields), deps)
    expect(result).toEqual({ kind: 'redirect', location: `${ORIGIN}${CONFIRM_INVALID_PATH}`, status: 303 })
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('exceção inesperada em verifyOtp → redirect "unavailable" e Sentry sem o token', async () => {
    const { deps } = makeDeps(async () => {
      throw new Error(`falha com ${TOKEN}`.replace(TOKEN, 'x'))
    })
    const result = await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }), deps)
    expect(result).toMatchObject({ kind: 'redirect', location: `${ORIGIN}${CONFIRM_UNAVAILABLE_PATH}` })
    expect(JSON.stringify(captureException.mock.calls)).not.toContain(TOKEN)
  })

  it('corpo ilegível ou Content-Type inesperado → redirect neutro', async () => {
    const { deps, verifyOtp } = makeDeps()
    const result = await handleConfirmRequest(form({}, { contentType: 'text/plain' }), deps)
    expect(result).toMatchObject({ kind: 'redirect', location: `${ORIGIN}${CONFIRM_INVALID_PATH}` })
    expect(verifyOtp).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/confirm — Origin, canônica e redirects', () => {
  it.each([
    ['Origin de outro domínio', { origin: 'https://evil.example' }],
    ['Origin ausente', { origin: null }],
  ])('%s → 403 e verifyOtp NÃO é chamado (login-CSRF)', async (_label, options) => {
    const { deps, verifyOtp } = makeDeps()
    const result = await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }, options), deps)
    expect(result).toMatchObject({ kind: 'error', status: 403 })
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('origem canônica ausente/inválida → 503 fail-closed', async () => {
    for (const env of [{}, { NEXT_PUBLIC_SITE_URL: 'não é url' }]) {
      const { deps, verifyOtp } = makeDeps(undefined, { env })
      expect(await handleConfirmRequest(form({ token_hash: TOKEN, type: 'signup' }), deps)).toMatchObject({ kind: 'error', status: 503 })
      expect(verifyOtp).not.toHaveBeenCalled()
    }
  })

  it('sem open redirect: o destino é sempre um de 3 caminhos FIXOS na origem canônica, ignorando qualquer parâmetro', async () => {
    const attack = form({ token_hash: TOKEN, type: 'signup', next: 'https://evil.example', redirect_to: 'https://evil.example', redirectTo: '//evil.example' })
    const result = await handleConfirmRequest(attack, makeDeps().deps)
    expect(result).toMatchObject({ kind: 'redirect', location: `${ORIGIN}${SET_PASSWORD_PATH}` })
    if (result.kind === 'redirect') expect(new URL(result.location).origin).toBe(ORIGIN)
  })
})

describe('limpeza de cadastros pendentes (7 dias)', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z')
  const pendingFlow = (id: string): CleanupUserInfo => ({ id, confirmed: false, hasSignedIn: false, createdByPublicFlow: true })

  function makePorts(overrides: { listed?: string[]; users?: Record<string, CleanupUserInfo | null>; deleteUser?: (id: string) => Promise<void> } = {}) {
    const listed = overrides.listed ?? []
    const users = overrides.users ?? {}
    const ports: PendingSignupCleanupPorts = {
      listStale: vi.fn().mockResolvedValue(listed),
      getUser: vi.fn(async (id: string) => (id in users ? users[id] : pendingFlow(id))),
      deleteUser: vi.fn(overrides.deleteUser ?? (async () => {})),
      now: () => NOW,
    }
    return ports
  }

  it('a retenção é de 7 dias e o corte enviado ao banco é agora − 7 dias', async () => {
    expect(PENDING_SIGNUP_RETENTION_DAYS).toBe(7)
    const ports = makePorts()
    const result = await cleanupPendingSignups(ports)
    expect(result.cutoff).toBe(new Date(NOW - 7 * 86_400_000).toISOString())
    expect(ports.listStale).toHaveBeenCalledWith(result.cutoff, CLEANUP_BATCH_SIZE)
  })

  it('remove somente pendentes do fluxo público listados pelo banco', async () => {
    const ports = makePorts({ listed: ['a', 'b'] })
    const result = await cleanupPendingSignups(ports)
    expect(result).toMatchObject({ candidates: 2, deleted: 2, skipped: 0, failed: 0 })
    expect(ports.deleteUser).toHaveBeenCalledWith('a')
    expect(ports.deleteUser).toHaveBeenCalledWith('b')
  })

  it.each([
    ['confirmou o e-mail entre a listagem e a exclusão', { id: 'x', confirmed: true, hasSignedIn: false, createdByPublicFlow: true }],
    ['já fez login', { id: 'x', confirmed: false, hasSignedIn: true, createdByPublicFlow: true }],
    ['não é do fluxo público (convite/admin/análise)', { id: 'x', confirmed: false, hasSignedIn: false, createdByPublicFlow: false }],
    ['já não existe', null],
  ])('segunda barreira: usuário que %s NUNCA é excluído', async (_label, user) => {
    const ports = makePorts({ listed: ['x'], users: { x: user } })
    const result = await cleanupPendingSignups(ports)
    expect(ports.deleteUser).not.toHaveBeenCalled()
    expect(result).toMatchObject({ candidates: 1, deleted: 0, skipped: 1 })
  })

  it('idempotente: sem candidatos não faz nada; rodar de novo após limpar não exclui de novo', async () => {
    const first = await cleanupPendingSignups(makePorts({ listed: ['a'] }))
    expect(first.deleted).toBe(1)
    const ports = makePorts({ listed: [] })
    expect(await cleanupPendingSignups(ports)).toMatchObject({ candidates: 0, deleted: 0 })
    expect(ports.deleteUser).not.toHaveBeenCalled()
  })

  it('a falha em um usuário não interrompe os demais e vai ao Sentry sem dados', async () => {
    const ports = makePorts({
      listed: ['a', 'b', 'c'],
      deleteUser: async (id) => {
        if (id === 'b') throw new Error('falha ao excluir b@example.com')
      },
    })
    const result = await cleanupPendingSignups(ports)
    expect(result).toMatchObject({ candidates: 3, deleted: 2, failed: 1 })
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(captureException.mock.calls)).not.toContain('b@example.com')
  })

  it('a listagem é a única fonte: o módulo nunca lista usuários por conta própria nem exclui em massa', () => {
    // A exclusão só recebe ids devolvidos por `listStale` e revalidados por `getUser`.
    const code = cleanupPendingSignups.toString()
    expect(code).toMatch(/listStale/)
    expect(code).not.toMatch(/listUsers|delete from|truncate/i)
  })
})
