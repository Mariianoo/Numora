/**
 * components/ui/EmptyState.tsx
 * Estado vazio profissional — substitui "0" solto ou texto cru.
 */
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from './utils'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-hover text-text-secondary">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {description && <p className="max-w-sm text-sm text-text-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
