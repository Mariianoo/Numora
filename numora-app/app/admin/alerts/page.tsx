/**
 * app/admin/alerts/page.tsx
 * Etapa "Admin Alerts V1" — primeira versão real de `/admin/alerts`,
 * substituindo o `AdminComingSoon`. Client Component, mesmo padrão de
 * `/admin/transactions`/`/admin/feedback` (sem reload).
 *
 * Auditoria "ADMIN ALERTS V1 — AUDIT REPORT" — escopo estritamente limitado
 * aos alertas Categoria A (dado real hoje, regra objetiva, zero
 * infraestrutura nova): cortesias expirando (`benefit_grants`) e feedback
 * crítico não resolvido (`feedbacks`).
 *
 * Etapa "B1 — Official Launch, código de cobrança": terceiro alerta,
 * assinaturas com pagamento pendente (`status = past_due`), derivado AO VIVO
 * do estado real via `admin_list_subscriptions` (RPC já existente, com a
 * autorização de admin feita no próprio banco) — nenhum alerta é gravado, então não há
 * duplicação possível; sem e-mail, sem escrita, sem sistema paralelo.
 * Independente das duas seções acima (próprio load/erro/vazio). Política
 * inalterada: `past_due` MANTÉM o acesso (`effective_plans()`); este alerta
 * só dá visibilidade operacional. Nenhum KPI agregado, nenhum filtro de
 * severidade, nenhuma classificação inventada — cada seção é uma consulta
 * objetiva independente, nunca misturadas numa lista única.
 *
 * READ-ONLY estrito: esta página nunca chama `.insert(`/`.update(`/`.delete(`
 * em nenhuma tabela. A "ação" de cada seção é sempre um LINK para a tela
 * onde a mutação real já existe e já é auditada (`/admin/members`,
 * `/admin/feedback`) — decisão deliberada: `FeedbackDetailModal` (existente
 * em `/admin/feedback`) inclui um formulário de edição funcional
 * (status/prioridade/notas); reutilizá-lo aqui daria a esta página um
 * caminho de escrita real, contradizendo a restrição explícita desta etapa
 * ("Alerta 2 — Somente SELECT, não alterar feedbacks"). Um link para
 * `/admin/feedback` cumpre "ação para abrir o feedback" sem essa
 * contradição, e não duplica nenhuma implementação (não implementa modal
 * nenhum).
 */
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Gift, Inbox } from 'lucide-react'

import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { createSupabaseAdminAlertsRepository, isCriticalUnresolvedFeedback } from '@/features/admin/repositories/admin-alerts.repository'
import { createSupabaseFeedbackAdminRepository } from '@/features/feedback/repositories/feedback-admin.repository'
import { createSupabaseAdminSubscriptionsRepository } from '@/features/billing/repositories/admin-subscriptions.repository'
import type { AdminSubscriptionRow } from '@/features/billing/types'
import { planLabel } from '@/lib/plans/plan-display'
import type { AdminExpiringBenefitGrant, BenefitType } from '@/features/admin/types'
import type { AdminFeedback, FeedbackPriority, FeedbackStatus } from '@/features/feedback/types'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'

const alertsRepository = createSupabaseAdminAlertsRepository()
const feedbackAdminRepository = createSupabaseFeedbackAdminRepository()
const subscriptionsRepository = createSupabaseAdminSubscriptionsRepository()

/** Limite de linhas do alerta — `past_due` é um estado transitório e raro; se passar disso, /admin/subscriptions (com filtro de status) continua sendo a lista completa. */
const PAST_DUE_ALERT_LIMIT = 50

const BENEFIT_TYPE_LABELS: Record<BenefitType, string> = {
  trial: 'Trial',
  courtesy: 'Cortesia',
  partnership: 'Parceria',
  beta: 'Beta',
  admin: 'Administrativo',
}

const FEEDBACK_TYPE_LABELS: Record<AdminFeedback['type'], string> = {
  praise: '❤️ Elogio',
  suggestion: '💡 Sugestão',
  problem: '🐛 Problema',
}

const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Novo',
  reviewing: 'Em análise',
  planned: 'Planejado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  dismissed: 'Descartado',
}

const FEEDBACK_PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

/** Link estilizado como botão secundário — nunca aninha um `<button>` real dentro de `<a>` (mesmo padrão de `PAGE_LINK_CLASSES` em app/admin/audit/page.tsx). */
const ACTION_LINK_CLASSES =
  'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface-hover px-3 text-xs font-medium text-text-primary transition-colors hover:bg-surface'

function ExpiringBenefitGrantsSection() {
  const [grants, setGrants] = useState<AdminExpiringBenefitGrant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return alertsRepository.listExpiringBenefitGrants()
      })
      .then(setGrants)
      .catch((err) => setError(getUserFriendlyErrorMessage(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-text-primary">Cortesias expirando</h2>

      {error ? (
        <ErrorState title="Não foi possível carregar as cortesias expirando" description={error} actionLabel="Tentar novamente" onAction={load} />
      ) : !isLoading && grants.length === 0 ? (
        <EmptyState icon={Gift} title="Nenhuma cortesia expira nos próximos 7 dias." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Usuário</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Tipo</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Expira em</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Ação</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 text-text-primary">
                      {grant.userName ?? <span className="text-text-secondary">—</span>}
                      <p className="text-xs text-text-secondary">{grant.userEmail ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="accent">{BENEFIT_TYPE_LABELS[grant.type]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{grant.expiresAt ? dateFormatter.format(new Date(grant.expiresAt)) : '—'}</td>
                    <td className="px-4 py-3">
                      <Link href="/admin/members" className={ACTION_LINK_CLASSES}>
                        Ver membro
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  )
}

function CriticalFeedbackSection() {
  const [feedbacks, setFeedbacks] = useState<AdminFeedback[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return feedbackAdminRepository.list()
      })
      .then((all) => setFeedbacks(all.filter(isCriticalUnresolvedFeedback)))
      .catch((err) => setError(getUserFriendlyErrorMessage(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-text-primary">Feedback crítico não resolvido</h2>

      {error ? (
        <ErrorState title="Não foi possível carregar o feedback crítico" description={error} actionLabel="Tentar novamente" onAction={load} />
      ) : !isLoading && feedbacks.length === 0 ? (
        <EmptyState icon={Inbox} title="Nenhum feedback crítico pendente." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Usuário</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Título</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Tipo</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Data</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Ação</th>
                </tr>
              </thead>
              <tbody>
                {feedbacks.map((feedback) => (
                  <tr key={feedback.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 text-text-primary">
                      {feedback.userName ?? feedback.userUsername ?? <span className="text-text-secondary">—</span>}
                      <p className="text-xs text-text-secondary">{feedback.userEmail ?? '—'}</p>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-text-primary">{feedback.title}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{FEEDBACK_TYPE_LABELS[feedback.type]}</td>
                    <td className="px-4 py-3">
                      <Badge tone="danger">{FEEDBACK_STATUS_LABELS[feedback.status]}</Badge>
                      <p className="mt-1 text-xs text-text-secondary">{FEEDBACK_PRIORITY_LABELS[feedback.priority]}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{dateFormatter.format(new Date(feedback.createdAt))}</td>
                    <td className="px-4 py-3">
                      <Link href="/admin/feedback" className={ACTION_LINK_CLASSES}>
                        Abrir feedback
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  )
}

const LAST_TRANSACTION_LABELS: Record<string, string> = {
  paid: 'Paga',
  pending: 'Pendente',
  failed: 'Falhou',
  refunded: 'Reembolsada',
}

function PastDueSubscriptionsSection() {
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return subscriptionsRepository.listSubscriptions({ statusFilter: 'past_due', limit: PAST_DUE_ALERT_LIMIT })
      })
      .then((page) => setSubscriptions(page.subscriptions))
      .catch((err) => setError(getUserFriendlyErrorMessage(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-text-primary">Pagamentos pendentes</h2>

      {error ? (
        <ErrorState title="Não foi possível carregar os pagamentos pendentes" description={error} actionLabel="Tentar novamente" onAction={load} />
      ) : !isLoading && subscriptions.length === 0 ? (
        <EmptyState icon={CreditCard} title="Nenhuma assinatura com pagamento pendente." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Usuário</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Plano</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Fim do período</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Última cobrança</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Ação</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription) => (
                  <tr key={subscription.subscriptionId} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 text-text-primary">
                      {subscription.userName ?? <span className="text-text-secondary">—</span>}
                      <p className="text-xs text-text-secondary">{subscription.userEmail ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="danger">{planLabel(subscription.planSlug)}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">
                      {subscription.currentPeriodEnd ? dateFormatter.format(new Date(subscription.currentPeriodEnd)) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">
                      {subscription.lastTransactionStatus ? (LAST_TRANSACTION_LABELS[subscription.lastTransactionStatus] ?? subscription.lastTransactionStatus) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link href="/admin/subscriptions" className={ACTION_LINK_CLASSES}>
                        Ver assinaturas
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  )
}

export default function AdminAlertsPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Alertas" description="Avisos operacionais derivados de dados reais — nenhum alerta é inventado." />

      <ExpiringBenefitGrantsSection />
      <CriticalFeedbackSection />
      <PastDueSubscriptionsSection />
    </div>
  )
}
