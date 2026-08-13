/**
 * components/ui/Select.tsx
 * Select base do design system — mesma identidade visual do Input.
 * Continua sendo um <select> nativo (acessibilidade/comportamento de
 * teclado de graça, sem componente de listbox customizado).
 */
import { forwardRef, useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from './utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id, className, children, ...props },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full appearance-none rounded-lg border bg-background px-3 pr-9 text-sm text-text-primary',
            'transition-colors outline-none',
            'focus:border-accent focus:ring-2 focus:ring-accent/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
})
