/**
 * components/ui/Badge.tsx
 * Selo pequeno para status/atributos (metal, conservação, quantidade etc.).
 */
import type { HTMLAttributes } from 'react'

import { cn } from './utils'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-text-secondary border-border',
  accent: 'bg-accent/10 text-accent border-accent/30',
  success: 'bg-success/10 text-success border-success/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
}

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
