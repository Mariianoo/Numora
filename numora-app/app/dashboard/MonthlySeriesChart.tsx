/**
 * app/dashboard/MonthlySeriesChart.tsx
 * "Gráfico" de série temporal mensal do Dashboard 2.0 (Etapa 13.2) —
 * barras verticais em CSS puro, mesmo espírito de DistributionCard.tsx
 * (Etapa 13.1): sem biblioteca de gráficos, valor sempre mostrado ao
 * lado da barra (nunca só o tamanho visual). Server Component puro.
 *
 * Reutilizado tanto para "Aquisições por mês" (valor em R$) quanto
 * "Exemplares adquiridos por mês" (quantidade) via `formatValue`.
 */
import type { LucideIcon } from 'lucide-react'

import type { MonthlyAcquisitionEntry } from '@/lib/stats/collection-stats'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

export interface MonthlySeriesChartProps {
  title: string
  icon: LucideIcon
  entries: MonthlyAcquisitionEntry[]
  emptyMessage: string
  formatValue: (value: number) => string
}

export function MonthlySeriesChart({ title, icon: Icon, entries, emptyMessage, formatValue }: MonthlySeriesChartProps) {
  const maxValue = Math.max(...entries.map((entry) => entry.value), 1)

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>

      {entries.length === 0 ? (
        <div className="mt-2">
          <EmptyState icon={Icon} title={emptyMessage} className="border-none px-0 py-6" />
        </div>
      ) : (
        <ul className="mt-6 flex items-end gap-1 sm:gap-2" aria-label={title}>
          {entries.map((entry) => (
            <li key={entry.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="max-w-full truncate text-[10px] font-medium text-text-primary sm:text-xs">
                {formatValue(entry.value)}
              </span>
              <div className="flex h-24 w-full items-end sm:h-32">
                <div
                  className="w-full rounded-t-sm bg-accent"
                  style={{ height: `${Math.max((entry.value / maxValue) * 100, 4)}%` }}
                />
              </div>
              <span className="max-w-full truncate text-[10px] text-text-secondary sm:text-xs">{entry.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
