/**
 * tests/unit/health-routes.test.ts
 * Etapa "5.10L-B — Health Check" — cobre os Route Handlers
 * `GET /api/health/live` e `GET /api/health/ready` chamando as funções
 * exportadas diretamente (mesmo padrão já usado para `proxy()` no
 * 5.10L-A — Next.js Route Handlers são funções simples, testáveis sem
 * subir servidor). `lib/health/ready-checks` é mockado aqui: a lógica de
 * cada check já tem cobertura própria em `health-ready-checks.test.ts`
 * — este arquivo testa só a ORQUESTRAÇÃO (status HTTP, payload, headers).
 * `getSupabaseServerClient` é mockado só para nunca precisar de uma
 * sessão/cookie real — o client retornado nunca é usado de verdade
 * porque `checkDatabase` também está mockado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/health/ready-checks', () => ({
  checkConfiguration: vi.fn(),
  checkDatabase: vi.fn(),
  checkStorage: vi.fn(),
}))

import { GET as liveGET } from '@/app/api/health/live/route'
import { GET as readyGET } from '@/app/api/health/ready/route'
import { checkConfiguration, checkDatabase, checkStorage } from '@/lib/health/ready-checks'

const mockedCheckConfiguration = vi.mocked(checkConfiguration)
const mockedCheckDatabase = vi.mocked(checkDatabase)
const mockedCheckStorage = vi.mocked(checkStorage)

beforeEach(() => {
  mockedCheckConfiguration.mockReset()
  mockedCheckDatabase.mockReset()
  mockedCheckStorage.mockReset()
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
    mockedCheckConfiguration.mockReturnValue('ok')
    mockedCheckDatabase.mockResolvedValue('ok')
    mockedCheckStorage.mockResolvedValue('ok')

    const response = await readyGET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', storage: 'ok', configuration: 'ok' },
    })
  })

  it('503 "not_ready" quando database falha (não expõe 42501/mensagem interna)', async () => {
    mockedCheckConfiguration.mockReturnValue('ok')
    mockedCheckDatabase.mockResolvedValue('fail')
    mockedCheckStorage.mockResolvedValue('ok')

    const response = await readyGET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'not_ready', checks: { database: 'fail', storage: 'ok', configuration: 'ok' } })
  })

  it('503 "not_ready" quando storage falha', async () => {
    mockedCheckConfiguration.mockReturnValue('ok')
    mockedCheckDatabase.mockResolvedValue('ok')
    mockedCheckStorage.mockResolvedValue('fail')

    const response = await readyGET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ status: 'not_ready', checks: { database: 'ok', storage: 'fail', configuration: 'ok' } })
  })

  it('503 "not_ready" quando configuration falha', async () => {
    mockedCheckConfiguration.mockReturnValue('fail')
    mockedCheckDatabase.mockResolvedValue('ok')
    mockedCheckStorage.mockResolvedValue('ok')

    const response = await readyGET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ status: 'not_ready', checks: { database: 'ok', storage: 'ok', configuration: 'fail' } })
  })

  it('resposta pública nunca contém detalhes internos, códigos Postgres ou nomes de secrets', async () => {
    mockedCheckConfiguration.mockReturnValue('fail')
    mockedCheckDatabase.mockResolvedValue('fail')
    mockedCheckStorage.mockResolvedValue('fail')

    const response = await readyGET()
    const text = await response.clone().text()

    expect(text).not.toMatch(/42501|permission denied|service_role|SUPABASE_SERVICE_ROLE_KEY|STRIPE|MAINTENANCE_BYPASS|stack/i)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('não depende de nenhum argumento de request (não exige sessão/cookie/autenticação)', async () => {
    await expect(readyGET()).resolves.toBeDefined()
  })
})
