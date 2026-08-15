/**
 * components/ui/IconButton.tsx
 * Botão só-ícone padronizado do design system (Etapa 12.3) — unifica os
 * `<button>` crus com classes Tailwind duplicadas manualmente que a
 * auditoria da Etapa 12.2 encontrou em Minha Coleção/Modal/Topbar (área
 * de toque variando de 16px a 32px sem critério). `aria-label` é
 * obrigatório pelo tipo; `title` cai para o mesmo valor quando omitido,
 * para nenhum controle ficar sem nome acessível nem sem tooltip nativo.
 *
 * Só 2 variantes e 2 tamanhos — os únicos que os controles reais do app
 * usam hoje (ver auditoria Etapa 12.2). Não adicionar variantes/tamanhos
 * especulativos sem um caso de uso real.
 */
'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'

import { cn } from './utils'

export type IconButtonVariant = 'ghost' | 'danger'
export type IconButtonSize = 'md' | 'sm'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon
  'aria-label': string
  variant?: IconButtonVariant
  size?: IconButtonSize
  isLoading?: boolean
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  danger: 'text-text-secondary hover:bg-danger/10 hover:text-danger',
}

// md = 44×44px (WCAG AA), sm = 32×32px — ver auditoria Etapa 12.2 para o
// critério de quando cada um se aplica.
const SIZE_CLASSES: Record<IconButtonSize, string> = {
  md: 'size-11',
  sm: 'size-8',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    variant = 'ghost',
    size = 'md',
    isLoading = false,
    disabled,
    title,
    className,
    type = 'button',
    'aria-label': ariaLabel,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
    </button>
  )
})
