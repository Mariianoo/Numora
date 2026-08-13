/**
 * components/ui/Card.tsx
 * Superfície base do design system.
 */
import type { HTMLAttributes } from 'react'

import { cn } from './utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean
}

export function Card({ hoverable = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface shadow-sm',
        hoverable && 'transition-all hover:border-border/80 hover:bg-surface-hover hover:shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
