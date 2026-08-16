/**
 * app/dashboard/AcquisitionsList.tsx
 * "Aquisições recentes" do Dashboard 2.0 (Etapa 13.2) — lista as últimas
 * N compras (uma linha por operação, nunca duplicada por
 * `collection_item` vinculado). Server Component puro, mesmo padrão de
 * card usado para "Última aquisição" (Etapa 13.1), agora para uma lista.
 */
import { ShoppingBag } from 'lucide-react'

import type { RecentAcquisition } from '@/lib/stats/collection-stats'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateOnly } from '@/lib/format/date'

export interface AcquisitionsListProps {
  acquisitions: RecentAcquisition[]
  currencyFormatter: Intl.NumberFormat
}

export function AcquisitionsList({ acquisitions, currencyFormatter }: AcquisitionsListProps) {
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-text-primary">Aquisições recentes</h2>

      {acquisitions.length === 0 ? (
        <div className="mt-2">
          <EmptyState
            icon={ShoppingBag}
            title="Nenhuma aquisição registrada"
            className="border-none px-0 py-6"
          />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {acquisitions.map((acquisition) => (
            <li
              key={acquisition.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-background px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-text-primary">
                  {acquisition.sellerName ?? 'Vendedor não informado'}
                </p>
                <p className="mt-0.5 text-sm text-text-secondary">
                  {acquisition.itemCount} exemplar{acquisition.itemCount === 1 ? '' : 'es'}
                  {acquisition.coinLabels.length > 0 && ` · ${acquisition.coinLabels.join(', ')}`}
                </p>
                {!acquisition.hasActiveItems && (
                  <p className="mt-1 text-xs font-medium text-accent">Sem itens ativos na coleção</p>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
                <p className="font-semibold text-text-primary">{currencyFormatter.format(acquisition.totalPrice)}</p>
                {acquisition.purchaseDate && (
                  <p className="text-sm text-text-secondary">{formatDateOnly(acquisition.purchaseDate)}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
