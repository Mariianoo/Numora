/**
 * features/labels/components/LabelSelectionToolbar.tsx
 * Etapa "F4 — Numora Labels" — barra de ação do modo de seleção em lote,
 * componente próprio (ver comentário de `use-label-selection.ts`).
 */
'use client'

import { Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'

export interface LabelSelectionToolbarProps {
  selectedCount: number
  onCancel: () => void
  onGenerate: () => void
}

export function LabelSelectionToolbar({ selectedCount, onCancel, onGenerate }: LabelSelectionToolbarProps) {
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-surface px-4 py-3 shadow-sm">
      <p className="text-sm font-medium text-text-primary">
        {selectedCount} moeda{selectedCount === 1 ? '' : 's'} selecionada{selectedCount === 1 ? '' : 's'}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          <X className="size-4" aria-hidden />
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={onGenerate} disabled={selectedCount === 0}>
          <Printer className="size-4" aria-hidden />
          Gerar etiquetas
        </Button>
      </div>
    </div>
  )
}
