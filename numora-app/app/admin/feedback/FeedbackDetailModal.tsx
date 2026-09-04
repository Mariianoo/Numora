/**
 * app/admin/feedback/FeedbackDetailModal.tsx
 * Detalhe + edição administrativa de um feedback (Etapa "F3 — Numora
 * Feedback") — mesmo padrão de app/admin/members/GrantCourtesyModal.tsx:
 * modal controlado por `item`, `onSubmit` delega ao repository (que já
 * encadeia `log_admin_action`), nunca SQL aqui.
 *
 * `admin_notes` só existe nesta tela — a página do usuário
 * (app/dashboard/feedback) nunca lê nem exibe este campo.
 */
'use client'

import { useState } from 'react'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Badge } from '@/components/ui/Badge'
import type { AdminFeedback, FeedbackPriority, FeedbackStatus, UpdateFeedbackAdminInput } from '@/features/feedback/types'

const TYPE_LABELS: Record<AdminFeedback['type'], string> = {
  praise: '❤️ Elogio',
  suggestion: '💡 Sugestão',
  problem: '🐛 Problema',
}

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Novo',
  reviewing: 'Em análise',
  planned: 'Planejado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  dismissed: 'Descartado',
}

const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
}

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export interface FeedbackDetailModalProps {
  feedback: AdminFeedback | null
  onClose: () => void
  onSubmit: (input: UpdateFeedbackAdminInput) => Promise<void>
}

/**
 * O componente pai (`app/admin/feedback/page.tsx`) monta isto com
 * `key={feedback?.id}` — cada feedback diferente força uma remontagem
 * completa, então os `useState` abaixo já nascem com os valores certos do
 * feedback atual, sem nenhum `useEffect` de sincronização (mesmo padrão já
 * usado por `CoinImageViewer` — `key` força reinicialização, nunca um
 * efeito resetando estado local a cada abertura).
 */
export function FeedbackDetailModal({ feedback, onClose, onSubmit }: FeedbackDetailModalProps) {
  const [status, setStatus] = useState<FeedbackStatus>(feedback?.status ?? 'new')
  const [priority, setPriority] = useState<FeedbackPriority>(feedback?.priority ?? 'medium')
  const [adminNotes, setAdminNotes] = useState(feedback?.adminNotes ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!feedback) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await onSubmit({ status, priority, adminNotes: adminNotes.trim() === '' ? null : adminNotes.trim() })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const authorLabel = feedback.userName ?? feedback.userUsername ?? feedback.userEmail ?? feedback.userId

  return (
    <Modal isOpen={Boolean(feedback)} onClose={onClose} title={feedback.title} description={TYPE_LABELS[feedback.type]}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-lg bg-surface-hover p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-text-primary">{authorLabel}</span>
            <span className="text-xs text-text-secondary">{dateTimeFormatter.format(new Date(feedback.createdAt))}</span>
          </div>
          {feedback.userEmail && authorLabel !== feedback.userEmail && (
            <span className="text-xs text-text-secondary">{feedback.userEmail}</span>
          )}
          {feedback.wantsContact && (
            <Badge tone="accent" className="mt-1 w-fit">
              Quer ser contatado
            </Badge>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-text-secondary">Mensagem</p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm text-text-primary">
            {feedback.message}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as FeedbackStatus)}>
            {(Object.keys(STATUS_LABELS) as FeedbackStatus[]).map((key) => (
              <option key={key} value={key}>
                {STATUS_LABELS[key]}
              </option>
            ))}
          </Select>

          <Select label="Prioridade" value={priority} onChange={(event) => setPriority(event.target.value as FeedbackPriority)}>
            {(Object.keys(PRIORITY_LABELS) as FeedbackPriority[]).map((key) => (
              <option key={key} value={key}>
                {PRIORITY_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>

        <Textarea
          label="Observação interna (visível só para a equipe Numora)"
          placeholder="Ex.: já priorizado para o próximo release..."
          value={adminNotes}
          onChange={(event) => setAdminNotes(event.target.value)}
          rows={3}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            Salvar alterações
          </Button>
        </div>
      </form>
    </Modal>
  )
}
