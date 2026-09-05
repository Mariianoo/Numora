/**
 * features/labels/use-label-selection.ts
 * Etapa "F4 — Numora Labels" — estado do modo de seleção em lote na tela de
 * coleção. Hook próprio (não inline em `app/dashboard/collection/page.tsx`,
 * já com ~3200 linhas) por pedido explícito do owner: "criar
 * componentes/hooks próprios para seleção... integrar com a página
 * existente de forma mínima".
 */
import { useState } from 'react'

export interface LabelSelection {
  isSelecting: boolean
  selectedIds: Set<string>
  start: () => void
  cancel: () => void
  toggle: (id: string) => void
}

export function useLabelSelection(): LabelSelection {
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function start() {
    setIsSelecting(true)
    setSelectedIds(new Set())
  }

  function cancel() {
    setIsSelecting(false)
    setSelectedIds(new Set())
  }

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return { isSelecting, selectedIds, start, cancel, toggle }
}
