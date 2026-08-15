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
 *
 * `initialFocusRef` (Etapa Lixeira/ConfirmDialog): opcional — quando
 * ausente, mantém o comportamento de sempre (foco no botão "Fechar").
 * `ConfirmDialog` passa o ref do botão "Cancelar" aqui, para que uma ação
 * destrutiva nunca fique com foco inicial num botão que a confirma.
 *
 * `aria-describedby`: só existia `aria-labelledby` antes desta etapa — a
 * descrição (quando presente) agora tem `id` próprio e o dialog a referencia,
 * benefício para TODOS os modais do app, não só o novo `ConfirmDialog`.
 *
 * Focus trap (Etapa Lixeira): Tab/Shift+Tab agora ciclam só entre os
 * elementos focáveis DENTRO do dialog — antes, Tab podia escapar para o
 * conteúdo por trás do overlay. Adicionado aqui (não só no `ConfirmDialog`)
 * porque é uma correção de acessibilidade real para qualquer modal, com
 * risco mínimo: só reage à tecla Tab, não muda nenhum comportamento visual
 * ou de mouse.
 */
'use client'

import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { X } from 'lucide-react'

import { IconButton } from './IconButton'

const openModalStack: string[] = []

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Foco inicial alternativo (ex.: botão "Cancelar" num ConfirmDialog) — padrão continua sendo o botão "Fechar". */
  initialFocusRef?: RefObject<HTMLElement | null>
}

export function Modal({ isOpen, onClose, title, description, children, footer, initialFocusRef }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const modalId = useId()
  const descriptionId = `${modalId}-description`

  useEffect(() => {
    if (!isOpen) return
    ;(initialFocusRef?.current ?? closeButtonRef.current)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mesmo motivo do comentário acima: só pode depender de `isOpen`, nunca de `initialFocusRef` (recriado a cada render do pai).
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    function handleTabTrap(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !dialogRef.current) return
      // só o modal do topo da pilha prende o Tab — mesma regra do Escape
      if (openModalStack[openModalStack.length - 1] !== modalId) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleTabTrap)
    return () => document.removeEventListener('keydown', handleTabTrap)
  }, [isOpen, modalId])

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id={`${modalId}-title`} className="text-lg font-semibold text-text-primary">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-text-secondary">
                {description}
              </p>
            )}
          </div>
          <IconButton ref={closeButtonRef} icon={X} onClick={onClose} aria-label="Fechar" />
        </div>

        <div className="overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-border bg-surface px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}
