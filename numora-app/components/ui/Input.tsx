/**
 * components/ui/Input.tsx
 * Input base do design system — label, erro, foco e disabled consistentes.
 *
 * `rightElement` (opcional, aditivo): slot para um controle pequeno dentro
 * do próprio campo (ex.: botão de mostrar/ocultar senha, ver
 * `PasswordInput`). Só existe um wrapper `relative`/padding extra quando
 * `rightElement` é passado — nenhum dos usos existentes de `Input` (que
 * nunca passam essa prop) muda de comportamento ou marcação.
 */
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

import { cn } from './utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  rightElement?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className, rightElement, ...props },
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
      <div className={rightElement ? 'relative' : undefined}>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full rounded-lg border bg-background px-3 text-sm text-text-primary placeholder:text-text-secondary/60',
            'transition-colors outline-none',
            'focus:border-accent focus:ring-2 focus:ring-accent/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            // Remove as setas nativas de spin de inputs number (visualmente
            // pesadas) sem afetar o comportamento — ainda dá pra usar as
            // setas do teclado normalmente.
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border',
            rightElement ? 'pr-11' : undefined,
            className,
          )}
          {...props}
        />
        {rightElement && <div className="absolute top-1/2 right-1 -translate-y-1/2">{rightElement}</div>}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
})
