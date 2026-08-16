/**
 * app/dashboard/DistributionCard.tsx
 * "Gráfico" de distribuição do Dashboard 2.0 (Etapa 13.1) — barras
 * horizontais em CSS puro (label + contagem + barra proporcional), sem
 * biblioteca de gráficos: o projeto não tinha nenhuma (`package.json`
 * auditado antes de escrever este arquivo) e esse estilo, minimalista e
 * nativo do design system (mesma paleta/tipografia de `Card`/`StatCard`),
 * atende ao pedido sem adicionar dependência nova. Server Component puro
 * (sem estado, sem interatividade) — renderiza direto dentro de
 * app/dashboard/page.tsx.
 *
 * Contagem é sempre mostrada ao lado do label (nunca só a barra) —
 * acessibilidade/Etapa 13.1 §18: a informação nunca depende só da cor ou
 * do tamanho visual da barra.
 */
import type { LucideIcon } from 'lucide-react'

import type { DistributionEntry } from '@/lib/stats/collection-stats'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

export interface DistributionCardProps {
  title: string
  icon: LucideIcon
  entries: DistributionEntry[]
  emptyMessage: string
}

export function DistributionCard({ title, icon: Icon, entries, emptyMessage }: DistributionCardProps) {
  const maxCount = Math.max(...entries.map((entry) => entry.count), 1)

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>

      {entries.length === 0 ? (
        <div className="mt-2">
          <EmptyState icon={Icon} title={emptyMessage} className="border-none px-0 py-6" />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3" aria-label={title}>
          {entries.map((entry) => (
            <li key={entry.key}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-text-secondary">
                  {entry.prefix && <span aria-hidden>{entry.prefix}</span>}
                  <span className="truncate">{entry.label}</span>
                </span>
                <span className="shrink-0 font-medium text-text-primary">{entry.count}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max((entry.count / maxCount) * 100, 4)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
