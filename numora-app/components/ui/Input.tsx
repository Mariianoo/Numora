/**
 * components/ui/Input.tsx
 * Input base do design system — label, erro, foco e disabled consistentes.
 */
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes } from 'react'

import { cn } from './utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-10 w-full rounded-lg border bg-background px-3 text-sm text-text-primary placeholder:text-text-secondary/60',
          'transition-colors outline-none',
          'focus:border-accent focus:ring-2 focus:ring-accent/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border',
          className,
        )}
        {...props}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
})
