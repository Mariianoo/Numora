/**
 * lib/health/status-view-model.ts
 * Etapa "5.10L-C — Status Page" — lógica PURA (sem I/O, sem JSX) que
 * decide o que `/status` deve mostrar, a partir de (1) o snapshot de
 * `getReadinessSnapshot()` e (2) as variáveis de ambiente de manutenção.
 * Extraída da página para ser testável sem precisar renderizar React
 * (este repositório não tem infraestrutura de render de Server Component
 * em `tests/unit` — mesma limitação já documentada em
 * `tests/unit/proxy-maintenance-mode.test.ts` para `app/maintenance/page.tsx`).
 *
 * `MaintenanceEnv` inclui DELIBERADAMENTE só as 4 variáveis que a UI
 * pode precisar exibir (`VERCEL_ENV`/`MAINTENANCE_MODE` para decidir SE
 * está em manutenção; `MAINTENANCE_REASON`/`MAINTENANCE_ETA` para o texto
 * opcional) — `MAINTENANCE_BYPASS_TOKEN` nunca aparece nesta interface,
 * então não há como este módulo ou a página vazá-lo, nem por engano.
 *
 * Etapa 6 do relatório 5.10L-C: a distinção "Degradado" vs "Indisponível"
 * não pode ser determinada com segurança pelos checks existentes (cada
 * um só devolve `'ok'|'fail'`, sem noção de severidade/parcialidade) —
 * por isso este módulo usa só 2 estados de operação normal (`operational`/
 * `unavailable`), mais um terceiro estado independente (`maintenance`)
 * vindo de uma fonte de verdade totalmente diferente (env vars, nunca os
 * checks). Nenhuma heurística de "quão indisponível" foi inventada.
 */
import type { CheckResult, ReadinessSnapshot } from './ready-checks'
import { isReadySnapshot } from './ready-checks'

export type ComponentState = 'operational' | 'unavailable' | 'maintenance'
export type OverallState = 'operational' | 'unavailable' | 'maintenance'

export interface StatusComponent {
  name: 'Aplicação' | 'Banco de dados' | 'Storage' | 'Configuração'
  state: ComponentState
}

export interface StatusViewModel {
  overall: OverallState
  components: StatusComponent[]
  maintenanceReason: string | null
  maintenanceEta: string | null
}

export interface MaintenanceEnv {
  vercelEnv: string | undefined
  maintenanceMode: string | undefined
  maintenanceReason: string | undefined
  maintenanceEta: string | undefined
}

/** Mesmo critério de `proxy.ts` (Etapa 5.10L-A) — nunca duplicado com lógica diferente. */
export function isMaintenanceActive(env: MaintenanceEnv): boolean {
  return env.vercelEnv === 'production' && env.maintenanceMode === 'true'
}

function toComponentState(check: CheckResult): 'operational' | 'unavailable' {
  return check === 'ok' ? 'operational' : 'unavailable'
}

export function buildStatusViewModel(params: { env: MaintenanceEnv; snapshot: ReadinessSnapshot }): StatusViewModel {
  const { env, snapshot } = params
  const maintenance = isMaintenanceActive(env)

  const components: StatusComponent[] = [
    { name: 'Aplicação', state: maintenance ? 'maintenance' : 'operational' },
    { name: 'Banco de dados', state: toComponentState(snapshot.database) },
    { name: 'Storage', state: toComponentState(snapshot.storage) },
    { name: 'Configuração', state: toComponentState(snapshot.configuration) },
  ]

  if (maintenance) {
    return {
      overall: 'maintenance',
      components,
      // Nunca inventado: string vazia/ausente vira `null` (nenhum texto padrão fictício).
      maintenanceReason: env.maintenanceReason || null,
      maintenanceEta: env.maintenanceEta || null,
    }
  }

  return {
    overall: isReadySnapshot(snapshot) ? 'operational' : 'unavailable',
    components,
    maintenanceReason: null,
    maintenanceEta: null,
  }
}
