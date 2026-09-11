/**
 * tests/unit/health-routes.test.ts
 * Etapa "5.10L-B — Health Check" (atualizado na Etapa "5.10L-C — Status
 * Page" após a extração de `getReadinessSnapshot()`) — cobre os Route
 * Handlers `GET /api/health/live` e `GET /api/health/ready` chamando as
 * funções exportadas diretamente (mesmo padrão já usado para `proxy()`
 * no 5.10L-A — Next.js Route Handlers são funções simples, testáveis sem
 * subir servidor). `lib/health/ready-checks` é mockado aqui: a lógica de
 * cada check (e agora de `getReadinessSnapshot`/`isReadySnapshot`) já tem
 * cobertura própria em `health-ready-checks.test.ts` — este arquivo testa
 * só a ORQUESTRAÇÃO do Route Handler (status HTTP, payload, headers).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/health/ready-checks', () => ({
  getReadinessSnapshot: vi.fn(),
  isReadySnapshot: vi.fn(),
}))

import { GET as liveGET } from '@/app/api/health/live/route'
import { GET as readyGET } from '@/app/api/health/ready/route'
import { getReadinessSnapshot, isReadySnapshot } from '@/lib/health/ready-checks'

const mockedGetReadinessSnapshot = vi.mocked(getReadinessSnapshot)
const mockedIsReadySnapshot = vi.mocked(isReadySnapshot)

beforeEach(() => {
  mockedGetReadinessSnapshot.mockReset()
  mockedIsReadySnapshot.mockReset()
})

describe('GET /api/health/live', () => {
  it('200, body {status:"ok"}, Cache-Control: no-store, sem argumentos de request (não depende de sessão/autenticação)', async () => {
    const response = await liveGET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })
})

describe('GET /api/health/ready', () => {
  it('200 "ready" quando database/storage/configuration estão todos ok', async () => {
    mockedGetReadinessSnapshot.mockResolvedValue({ database: 'ok', storage: 'ok', configuration: 'ok' })
    mockedIsReadySnapshot.mockReturnValue(true)

    const response = await readyGET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', storage: 'ok', configuration: 'ok' },
    })
  })

  it('503 "not_ready" quando database falha (não expõe 42501/mensagem interna)', async () => {
    mockedGetReadinessSnapshot.mockResolvedValue({ database: 'fail', storage: 'ok', configuration: 'ok' })
    mockedIsReadySnapshot.mockReturnValue(false)

    const response = await readyGET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'not_ready', checks: { database: 'fail', storage: 'ok', configuration: 'ok' } })
  })

  it('503 "not_ready" quando storage falha', async () => {
    mockedGetReadinessSnapshot.mockResolvedValue({ database: 'ok', storage: 'fail', configuration: 'ok' })
    mockedIsReadySnapshot.mockReturnValue(false)

    const response = await readyGET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ status: 'not_ready', checks: { database: 'ok', storage: 'fail', configuration: 'ok' } })
  })

  it('503 "not_ready" quando configuration falha', async () => {
    mockedGetReadinessSnapshot.mockResolvedValue({ database: 'ok', storage: 'ok', configuration: 'fail' })
    mockedIsReadySnapshot.mockReturnValue(false)

    const response = await readyGET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ status: 'not_ready', checks: { database: 'ok', storage: 'ok', configuration: 'fail' } })
  })

  it('resposta pública nunca contém detalhes internos, códigos Postgres ou nomes de secrets', async () => {
    mockedGetReadinessSnapshot.mockResolvedValue({ database: 'fail', storage: 'fail', configuration: 'fail' })
    mockedIsReadySnapshot.mockReturnValue(false)

    const response = await readyGET()
    const text = await response.clone().text()

    expect(text).not.toMatch(/42501|permission denied|service_role|SUPABASE_SERVICE_ROLE_KEY|STRIPE|MAINTENANCE_BYPASS|stack/i)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('não depende de nenhum argumento de request (não exige sessão/cookie/autenticação)', async () => {
    mockedGetReadinessSnapshot.mockResolvedValue({ database: 'ok', storage: 'ok', configuration: 'ok' })
    mockedIsReadySnapshot.mockReturnValue(true)

    await expect(readyGET()).resolves.toBeDefined()
  })
})
