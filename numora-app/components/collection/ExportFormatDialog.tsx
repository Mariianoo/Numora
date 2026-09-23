/**
 * components/collection/ExportFormatDialog.tsx
 * Etapa "XLSX UI Integration" — diálogo leve de escolha de formato de
 * exportação (CSV ou Excel), aberto SÓ depois que o chamador já confirmou
 * o entitlement `exports` como habilitado (nunca decide isso aqui — sem
 * paywall próprio, sem checagem de plano). Reaproveita o `Modal` genérico
 * do design system (mesmo padrão de `UpgradeToProDialog`) — não é um novo
 * primitivo de UI, é uma composição específica desta tela.
 *
 * Puramente apresentacional: geração do arquivo, download e analytics
 * continuam inteiramente em `app/dashboard/collection/page.tsx` (única
 * fonte de verdade de `items`/`triggerBrowserDownload`/`trackExportCompleted`)
 * — este componente só informa QUAL formato o usuário escolheu, via
 * `onSelect`. Nunca chama `generateCollectionCsv`/`generateCollectionXlsx`
 * diretamente.
 */
'use client'

import { FileSpreadsheet, FileText } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export type ExportFormat = 'csv' | 'xlsx'

export interface ExportFormatDialogProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (format: ExportFormat) => void
  /**
   * Formato em geração no momento — `null` quando nenhuma geração está em
   * voo. Desabilita os dois botões (nunca permite duas exportações
   * simultâneas) e mostra o spinner só no botão efetivamente escolhido.
   */
  generatingFormat: ExportFormat | null
}

export function ExportFormatDialog({ isOpen, onClose, onSelect, generatingFormat }: ExportFormatDialogProps) {
  const isBusy = generatingFormat !== null

  function handleClose() {
    // Nunca fecha com uma geração em voo — evita perder de vista um clique já em andamento.
    if (isBusy) return
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Exportar coleção"
      description="Escolha o formato do arquivo."
      footer={
        <Button type="button" variant="ghost" onClick={handleClose} disabled={isBusy}>
          Cancelar
        </Button>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          className="flex-1 justify-start"
          onClick={() => onSelect('csv')}
          isLoading={generatingFormat === 'csv'}
          disabled={isBusy}
        >
          <FileText className="size-4" aria-hidden />
          CSV
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1 justify-start"
          onClick={() => onSelect('xlsx')}
          isLoading={generatingFormat === 'xlsx'}
          disabled={isBusy}
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          Excel (.xlsx)
        </Button>
      </div>
    </Modal>
  )
}
