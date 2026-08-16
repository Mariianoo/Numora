/**
 * components/ui/ErrorState.tsx
 * Estado de erro profissional para falha de CARREGAMENTO de uma
 * tela/seção inteira (Etapa 12.4) — irmão do `EmptyState`, nunca
 * confundido com ele: `EmptyState` = "não há dados"; `ErrorState` = "não
 * conseguimos carregar os dados". A auditoria da Etapa 12.4 encontrou
 * casos reais (Coleção, Lixeira) onde uma falha de carregamento acabava
 * renderizando `EmptyState` — ativamente enganoso, o problema que este
 * componente resolve.
 *
 * `onAction` (retry) gerencia seu próprio estado de loading internamente
 * — nenhum `RetryButton` separado nesta etapa (ver auditoria, item 13):
 * um botão de retry duplicado em cada tela não justificava um componente
 * à parte ainda.
 */
'use client'

import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TriangleAlert } from 'lucide-react'

import { cn } from './utils'
import { Button } from './Button'

export interface ErrorStateProps {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void | Promise<void>
  icon?: LucideIcon
  className?: string
}

export function ErrorState({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = TriangleAlert,
  className,
}: ErrorStateProps) {
  const [isRetrying, setIsRetrying] = useState(false)

  async function handleAction() {
    if (!onAction || isRetrying) return
    setIsRetrying(true)
    try {
      await onAction()
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/25 bg-danger/5 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {description && <p className="max-w-sm text-sm text-text-secondary">{description}</p>}
      {onAction && actionLabel && (
        <Button type="button" onClick={handleAction} isLoading={isRetrying} className="mt-2">
          {isRetrying ? 'Tentando novamente...' : actionLabel}
        </Button>
      )}
    </div>
  )
}
