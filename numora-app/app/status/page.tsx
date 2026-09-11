/**
 * app/status/page.tsx
 * Etapa "5.10L-C — Status Page" — página pública de observabilidade.
 * Server Component puro: nenhum client Supabase no browser, nenhuma
 * sessão/cookie/autenticação exigida, nenhum dado de usuário/coleção,
 * nenhum Stripe, nenhum `service_role`.
 *
 * Reaproveita INTEIRAMENTE a mesma camada de checks do 5.10L-B — nunca
 * chama `GET /api/health/ready` via HTTP a partir daqui (evitaria um
 * round-trip interno desnecessário: mesmo processo, mesmo runtime,
 * nenhum ganho); chama `getReadinessSnapshot()` diretamente, a MESMA
 * função usada por aquele Route Handler (Etapa 5.10L-C também extraiu
 * essa função para `lib/health/ready-checks.ts`, eliminando a duplicação
 * que existiria se cada superfície reimplementasse "rodar os 3 checks").
 * A interpretação de qual estado mostrar (operacional/indisponível/
 * manutenção) é lógica pura em `lib/health/status-view-model.ts`,
 * testável sem precisar renderizar React.
 *
 * MAINTENANCE_BYPASS_TOKEN nunca é lido aqui — `MaintenanceEnv` (o tipo
 * usado por `buildStatusViewModel`) nem declara esse campo, então não há
 * como esta página vazá-lo, propositalmente ou por engano.
 *
 * `dynamic = 'force-dynamic'`: preferido a um cache curto (15-30s, como a
 * especificação da etapa cogitou) porque misturar cache com Maintenance
 * Mode é exatamente o risco que a própria especificação pede para evitar
 * — um `/status` cacheado por até 30s poderia mostrar "Operacional" logo
 * depois de um admin ativar `MAINTENANCE_MODE`, o pior momento possível
 * para informação desatualizada numa página cujo propósito é justamente
 * comunicar um incidente em andamento. Mesma decisão já tomada para
 * `/maintenance` no 5.10L-A.
 */
export const dynamic = 'force-dynamic'

import Link from 'next/link'

import { Card } from '@/components/ui/Card'
import { getReadinessSnapshot } from '@/lib/health/ready-checks'
import { buildStatusViewModel, type OverallState } from '@/lib/health/status-view-model'

export const metadata = {
  title: 'Status — Numora',
  description: 'Status operacional dos serviços do Numora.',
  robots: { index: false, follow: false },
}

const OVERALL_LABEL: Record<OverallState, string> = {
  operational: 'Operacional',
  unavailable: 'Indisponível',
  maintenance: 'Em manutenção',
}

const OVERALL_DOT_CLASS: Record<OverallState, string> = {
  operational: 'bg-success',
  unavailable: 'bg-danger',
  maintenance: 'bg-accent',
}

const COMPONENT_LABEL = {
  operational: 'Operacional',
  unavailable: 'Indisponível',
  maintenance: 'Em manutenção',
} as const

const COMPONENT_DOT_CLASS = {
  operational: 'bg-success',
  unavailable: 'bg-danger',
  maintenance: 'bg-accent',
} as const

export default async function StatusPage() {
  const snapshot = await getReadinessSnapshot()
  const view = buildStatusViewModel({
    env: {
      vercelEnv: process.env.VERCEL_ENV,
      maintenanceMode: process.env.MAINTENANCE_MODE,
      maintenanceReason: process.env.MAINTENANCE_REASON,
      maintenanceEta: process.env.MAINTENANCE_ETA,
    },
    snapshot,
  })

  // Confiável porque a página nunca é cacheada (`force-dynamic` + `no-store`
  // implícito) — é exatamente o instante em que esta resposta foi montada.
  const checkedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-accent">
          ← Voltar para o Numora
        </Link>
      </div>

      <div>
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">Numora</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-primary">Status</h1>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className={`size-3 rounded-full ${OVERALL_DOT_CLASS[view.overall]}`} aria-hidden />
          <span className="text-lg font-semibold text-text-primary">{OVERALL_LABEL[view.overall]}</span>
        </div>

        {view.overall === 'maintenance' && (
          <div className="mt-3 flex flex-col gap-1 text-sm text-text-secondary">
            {view.maintenanceReason && <p>Motivo: {view.maintenanceReason}</p>}
            {view.maintenanceEta && <p>Previsão de retorno: {view.maintenanceEta}</p>}
            {!view.maintenanceReason && !view.maintenanceEta && <p>Estamos realizando uma manutenção programada.</p>}
          </div>
        )}
      </Card>

      <Card className="divide-y divide-border p-0">
        {view.components.map((component) => (
          <div key={component.name} className="flex items-center justify-between px-6 py-4">
            <span className="text-sm text-text-primary">{component.name}</span>
            <span className="flex items-center gap-2 text-sm text-text-secondary">
              <span className={`size-2 rounded-full ${COMPONENT_DOT_CLASS[component.state]}`} aria-hidden />
              {COMPONENT_LABEL[component.state]}
            </span>
          </div>
        ))}
      </Card>

      <p className="text-center text-xs text-text-secondary">Última verificação: {checkedAt}</p>
    </div>
  )
}
