/**
 * components/ui/StatCard.tsx
 * Card de estatística do Dashboard — ícone + rótulo + valor + contexto.
 */
import type { LucideIcon } from 'lucide-react'

import { Card } from './Card'

export interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string
  description?: string
}

export function StatCard({ icon: Icon, label, value, description }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon className="size-[18px]" aria-hidden />
        </div>
      </div>
      {/* Etapa 13.2: valores monetários longos (ex.: "R$ 12.345,50") podem
          ultrapassar a largura do card enquanto o grid do Dashboard ainda
          está em 2 colunas (mobile e tablet) — só volta ao tamanho
          original (text-3xl) a partir de `lg`, quando o grid já abriu
          mais colunas e sobra espaço real por card. */}
      <p className="mt-3 text-lg font-semibold tracking-tight text-text-primary sm:text-xl lg:text-3xl">{value}</p>
      {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
    </Card>
  )
}
