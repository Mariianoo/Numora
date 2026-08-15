/**
 * components/ui/ConfirmDialog.tsx
 * Confirmação de ação profissional do design system — substitui
 * `window.confirm()` (Etapa Lixeira) em todo o app. Envolve `Modal`
 * (nunca reimplementa overlay/Escape/pilha/focus trap), só adiciona:
 * foco inicial em "Cancelar" (nunca no botão de ação, para que Enter logo
 * após abrir nunca confirme a ação — exigência explícita desta etapa) e
 * um corpo estruturado para os detalhes do item afetado.
 *
 * `isDestructive` controla só o tom visual do botão de ação
 * (`danger` vs `primary`) — "mover para a lixeira" é reversível e usa
 * `isDestructive={false}` (tom neutro/primário); "excluir permanentemente"
 * é irreversível e usa `isDestructive={true}` (`Button variant="danger"`,
 * já com fundo suave — nunca o modal inteiro vermelho).
 */
'use client'

import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { Modal } from './Modal'
import { Button } from './Button'

export interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: string
  /** Aviso extra de irreversibilidade (ex.: "Esta ação não pode ser desfeita.") — omitido quando a ação é reversível. */
  warning?: string
  /** Bloco de detalhes do item afetado (denominação/país/ano/exemplares/valor) — layout livre do caller. */
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  icon?: LucideIcon
  isDestructive?: boolean
  isLoading?: boolean
  error?: string | null
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  warning,
  children,
  confirmLabel,
  cancelLabel = 'Cancelar',
  icon: Icon,
  isDestructive = false,
  isLoading = false,
  error,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      initialFocusRef={cancelButtonRef}
      footer={
        <>
          <Button ref={cancelButtonRef} type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {Icon && (
          <div
            className={
              isDestructive
                ? 'flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger'
                : 'flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent'
            }
          >
            <Icon className="size-5" aria-hidden />
          </div>
        )}

        {children}

        {warning && <p className="text-sm font-medium text-danger">{warning}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
