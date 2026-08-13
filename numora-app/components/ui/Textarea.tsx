/**
 * components/ui/Textarea.tsx
 * Textarea base do design system — mesma identidade visual do Input.
 */
import { forwardRef, useId } from 'react'
import type { TextareaHTMLAttributes } from 'react'

import { cn } from './utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, id, className, ...props },
  ref,
) {
  const generatedId = useId()
  const textareaId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'min-h-20 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60',
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
