/**
 * app/admin/feedback/page.tsx
 * Central de Feedback — visão administrativa (Etapa "F3 — Numora
 * Feedback"). Client Component, mesmo padrão de app/admin/members/page.tsx
 * (lista interativa sem reload). Protegida por `app/admin/layout.tsx`
 * (`requireAdmin()`) como qualquer rota `/admin/*` — nenhuma checagem de
 * role adicional aqui; a RLS (`feedbacks_select_admin`/`feedbacks_update_admin`,
 * `is_platform_admin()`) é a barreira real.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Inbox, Sparkles, Lightbulb, Bug, Heart } from 'lucide-react'

import { createSupabaseFeedbackAdminRepository } from '@/features/feedback/repositories/feedback-admin.repository'
import type { AdminFeedback, FeedbackPriority, FeedbackStatus, UpdateFeedbackAdminInput } from '@/features/feedback/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeedbackDetailModal } from './FeedbackDetailModal'

const feedbackAdminRepository = createSupabaseFeedbackAdminRepository()

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

const STATUS_TONE: Record<FeedbackStatus, 'neutral' | 'accent' | 'success' | 'danger'> = {
  new: 'accent',
  reviewing: 'accent',
  planned: 'neutral',
  in_progress: 'accent',
  completed: 'success',
  dismissed: 'danger',
}

const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
}

const PRIORITY_TONE: Record<FeedbackPriority, 'neutral' | 'accent' | 'success' | 'danger'> = {
  low: 'neutral',
  medium: 'accent',
  high: 'danger',
  critical: 'danger',
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

export default function AdminFeedbackPage() {
  const [feedbacks, setFeedbacks] = useState<AdminFeedback[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminFeedback | null>(null)

  // `.then()` (não async/await) dentro do useEffect — mesmo padrão já usado
  // em app/admin/members/page.tsx (evita react-hooks/set-state-in-effect).
  const loadFeedbacks = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return feedbackAdminRepository.list()
      })
      .then(setFeedbacks)
      .catch((err) => setError((err as Error).message))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadFeedbacks()
  }, [loadFeedbacks])

  async function handleUpdate(input: UpdateFeedbackAdminInput) {
    if (!selected) return
    const updated = await feedbackAdminRepository.updateAdmin(selected.id, input)
    // `updated` é `Feedback` (nunca `adminNotes` — essa coluna vive em
    // feedback_admin_notes, tabela separada, ver
    // features/feedback/repositories/feedback-admin.repository.ts). Sem
    // isto, um `adminNotes` recém-salvo ficaria "esquecido" no estado local
    // até a próxima chamada de `list()`, porque `{...f, ...updated}` nunca
    // toca essa chave.
    setFeedbacks((current) =>
      current.map((f) =>
        f.id === updated.id
          ? { ...f, ...updated, ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}) }
          : f,
      ),
    )
    setSelected(null)
  }

  const total = feedbacks.length
  const totalNew = feedbacks.filter((f) => f.status === 'new').length
  const totalSuggestions = feedbacks.filter((f) => f.type === 'suggestion').length
  const totalProblems = feedbacks.filter((f) => f.type === 'problem').length
  const totalPraise = feedbacks.filter((f) => f.type === 'praise').length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Feedback" description="Elogios, sugestões e problemas relatados pelos colecionadores do Closed Beta." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={Inbox} label="Total" value={String(total)} />
        <StatCard icon={Sparkles} label="Novos" value={String(totalNew)} />
        <StatCard icon={Lightbulb} label="Sugestões" value={String(totalSuggestions)} />
        <StatCard icon={Bug} label="Problemas" value={String(totalProblems)} />
        <StatCard icon={Heart} label="Elogios" value={String(totalPraise)} />
      </div>

      {error ? (
        <ErrorState title="Não foi possível carregar os feedbacks" description={error} actionLabel="Tentar novamente" onAction={loadFeedbacks} />
      ) : !isLoading && feedbacks.length === 0 ? (
        <EmptyState icon={Inbox} title="Nenhum feedback recebido ainda" description="Assim que um colecionador enviar, ele aparece aqui." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Tipo</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Título</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Usuário</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Data</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {feedbacks.map((feedback) => (
                  <tr
                    key={feedback.id}
                    onClick={() => setSelected(feedback)}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{TYPE_LABELS[feedback.type]}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-text-primary">{feedback.title}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {feedback.userName ?? feedback.userUsername ?? feedback.userEmail ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{dateFormatter.format(new Date(feedback.createdAt))}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[feedback.status]}>{STATUS_LABELS[feedback.status]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={PRIORITY_TONE[feedback.priority]}>{PRIORITY_LABELS[feedback.priority]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <FeedbackDetailModal key={selected?.id ?? 'none'} feedback={selected} onClose={() => setSelected(null)} onSubmit={handleUpdate} />
    </div>
  )
}
