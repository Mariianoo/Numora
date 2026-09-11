/**
 * tests/unit/status-view-model.test.ts
 * Etapa "5.10L-C — Status Page" — cobre `lib/health/status-view-model.ts`
 * (lógica pura, sem I/O, sem React) que decide o que `/status` mostra.
 * Não precisa mockar nada (nenhuma chamada externa nesta camada).
 */
import { describe, expect, it } from 'vitest'

import { buildStatusViewModel, isMaintenanceActive, type MaintenanceEnv } from '@/lib/health/status-view-model'
import type { ReadinessSnapshot } from '@/lib/health/ready-checks'

const ALL_OK: ReadinessSnapshot = { database: 'ok', storage: 'ok', configuration: 'ok' }
const OFF_ENV: MaintenanceEnv = { vercelEnv: 'production', maintenanceMode: 'false', maintenanceReason: undefined, maintenanceEta: undefined }
const ON_ENV: MaintenanceEnv = { vercelEnv: 'production', maintenanceMode: 'true', maintenanceReason: undefined, maintenanceEta: undefined }

describe('isMaintenanceActive', () => {
  it('production + MAINTENANCE_MODE=true → true', () => {
    expect(isMaintenanceActive(ON_ENV)).toBe(true)
  })

  it('production + MAINTENANCE_MODE=false → false', () => {
    expect(isMaintenanceActive(OFF_ENV)).toBe(false)
  })

  it('preview + MAINTENANCE_MODE=true → false (mesmo critério de proxy.ts)', () => {
    expect(isMaintenanceActive({ ...ON_ENV, vercelEnv: 'preview' })).toBe(false)
  })

  it('VERCEL_ENV ausente + MAINTENANCE_MODE=true → false', () => {
    expect(isMaintenanceActive({ ...ON_ENV, vercelEnv: undefined })).toBe(false)
  })
})

describe('buildStatusViewModel — operação normal (sem manutenção)', () => {
  it('todos os checks ok → overall operational, todos os componentes operational', () => {
    const view = buildStatusViewModel({ env: OFF_ENV, snapshot: ALL_OK })

    expect(view.overall).toBe('operational')
    expect(view.components).toEqual([
      { name: 'Aplicação', state: 'operational' },
      { name: 'Banco de dados', state: 'operational' },
      { name: 'Storage', state: 'operational' },
      { name: 'Configuração', state: 'operational' },
    ])
    expect(view.maintenanceReason).toBeNull()
    expect(view.maintenanceEta).toBeNull()
  })

  it('database falha → overall unavailable, só o componente Banco de dados reflete a falha', () => {
    const snapshot: ReadinessSnapshot = { ...ALL_OK, database: 'fail' }
    const view = buildStatusViewModel({ env: OFF_ENV, snapshot })

    expect(view.overall).toBe('unavailable')
    expect(view.components.find((c) => c.name === 'Banco de dados')?.state).toBe('unavailable')
    expect(view.components.find((c) => c.name === 'Storage')?.state).toBe('operational')
    expect(view.components.find((c) => c.name === 'Configuração')?.state).toBe('operational')
  })

  it('storage falha → overall unavailable', () => {
    const snapshot: ReadinessSnapshot = { ...ALL_OK, storage: 'fail' }
    expect(buildStatusViewModel({ env: OFF_ENV, snapshot }).overall).toBe('unavailable')
  })

  it('configuration falha → overall unavailable', () => {
    const snapshot: ReadinessSnapshot = { ...ALL_OK, configuration: 'fail' }
    expect(buildStatusViewModel({ env: OFF_ENV, snapshot }).overall).toBe('unavailable')
  })

  it('nunca produz um terceiro estado "degradado" — só operational/unavailable fora de manutenção', () => {
    const partial: ReadinessSnapshot = { database: 'ok', storage: 'fail', configuration: 'ok' }
    const view = buildStatusViewModel({ env: OFF_ENV, snapshot: partial })
    expect(['operational', 'unavailable']).toContain(view.overall)
  })
})

describe('buildStatusViewModel — Maintenance Mode', () => {
  it('manutenção ativa → overall maintenance, independente do snapshot', () => {
    const view = buildStatusViewModel({ env: ON_ENV, snapshot: ALL_OK })
    expect(view.overall).toBe('maintenance')

    const viewWithFailures = buildStatusViewModel({ env: ON_ENV, snapshot: { database: 'fail', storage: 'fail', configuration: 'fail' } })
    expect(viewWithFailures.overall).toBe('maintenance')
  })

  it('componente Aplicação reflete "maintenance"; Banco de dados/Storage/Configuração continuam refletindo o snapshot real', () => {
    const snapshot: ReadinessSnapshot = { database: 'ok', storage: 'fail', configuration: 'ok' }
    const view = buildStatusViewModel({ env: ON_ENV, snapshot })

    expect(view.components.find((c) => c.name === 'Aplicação')?.state).toBe('maintenance')
    expect(view.components.find((c) => c.name === 'Banco de dados')?.state).toBe('operational')
    expect(view.components.find((c) => c.name === 'Storage')?.state).toBe('unavailable')
  })

  it('MAINTENANCE_REASON aparece somente quando configurado', () => {
    const withReason = buildStatusViewModel({ env: { ...ON_ENV, maintenanceReason: 'Migração de banco' }, snapshot: ALL_OK })
    expect(withReason.maintenanceReason).toBe('Migração de banco')

    const withoutReason = buildStatusViewModel({ env: ON_ENV, snapshot: ALL_OK })
    expect(withoutReason.maintenanceReason).toBeNull()
  })

  it('MAINTENANCE_ETA aparece somente quando configurado (nunca inventado)', () => {
    const withEta = buildStatusViewModel({ env: { ...ON_ENV, maintenanceEta: '15 minutos' }, snapshot: ALL_OK })
    expect(withEta.maintenanceEta).toBe('15 minutos')

    const withoutEta = buildStatusViewModel({ env: ON_ENV, snapshot: ALL_OK })
    expect(withoutEta.maintenanceEta).toBeNull()
  })

  it('MaintenanceEnv não tem (e não pode ter) campo de bypass token — nenhuma forma deste módulo vazá-lo', () => {
    const env: MaintenanceEnv = ON_ENV
    expect(Object.keys(env)).not.toContain('maintenanceBypassToken')
    expect(JSON.stringify(buildStatusViewModel({ env, snapshot: ALL_OK }))).not.toMatch(/bypass/i)
  })
})
