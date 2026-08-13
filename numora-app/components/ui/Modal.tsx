/**
 * components/ui/Modal.tsx
 * Modal profissional para formulários longos — cabeçalho fixo, corpo
 * rolável, footer fixo com ações. Implementação própria (div + role
 * "dialog"), sem dependência externa.
 *
 * Foco inicial e listener de Escape são dois `useEffect` SEPARADOS de
 * propósito (bug corrigido — ver histórico): o efeito de foco só pode
 * depender de `isOpen`, nunca de `onClose`. Callers costumam passar uma
 * função `onClose` inline/recriada a cada render (ex.: `closeModal` sem
 * `useCallback`); se ela estivesse nas deps do efeito de foco, QUALQUER
 * re-render do formulário pai (uma tecla digitada em qualquer campo)
 * disparava `closeButtonRef.current?.focus()` de novo, roubando o foco
 * de volta para o botão "Fechar" — e como Espaço/Enter ativam um
 * `<button>` focado nativamente, a tecla seguinte fechava o modal
 * sozinho. O listener de Escape pode continuar dependendo de `onClose`
 * sem problema: recriar um listener de teclado a cada render é inócuo,
 * só o roubo de foco causava o bug.
 *
 * `openModalStack`: quando dois `Modal` ficam abertos ao mesmo tempo
 * (ex.: o popup de ajuda de Conservação sobre o modal de
 * Adicionar/Editar moeda), cada instância registra seu próprio listener
 * de Escape no `document` — sem coordenação, Escape fecharia os DOIS de
 * uma vez (ou, dependendo da ordem de registro, o de baixo em vez do de
 * cima). Esta pilha simples, em nível de módulo, garante que só o modal
 * aberto por último (o do topo, visualmente) responda ao Escape — os
 * demais ignoram o evento até o do topo fechar.
 */
'use client'

import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

const openModalStack: string[] = []

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ isOpen, onClose, title, description, children, footer }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const modalId = useId()

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    openModalStack.push(modalId)
    return () => {
      const index = openModalStack.indexOf(modalId)
      if (index !== -1) openModalStack.splice(index, 1)
    }
  }, [isOpen, modalId])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // só o modal do topo da pilha fecha — os demais ignoram este Escape
      if (openModalStack[openModalStack.length - 1] !== modalId) return
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, modalId])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-text-primary">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-border bg-surface px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}
