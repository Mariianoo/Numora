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
      <p className="mt-3 text-3xl font-semibold tracking-tight text-text-primary">{value}</p>
      {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
    </Card>
  )
}
