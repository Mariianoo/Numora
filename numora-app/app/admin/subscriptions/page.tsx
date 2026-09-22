/**
 * app/admin/subscriptions/page.tsx
 * Etapa "Admin Subscriptions V1" — primeira versão real de `/admin/subscriptions`,
 * substituindo o `AdminComingSoon`. Client Component (filtros/paginação sem
 * reload, mesmo padrão de `/admin/members`).
 *
 * FONTE ÚNICA: `admin_list_subscriptions()`/`admin_subscriptions_summary()`
 * — representam EXCLUSIVAMENTE assinaturas Stripe reais
 * (`public.subscriptions`). Esta tela NUNCA mostra cortesia/beta/partnership
 * (`benefit_grants`, gerenciadas em `/admin/members`) nem a Conta de Análise
 * (`/admin/analysis-account`) — são conceitos deliberadamente separados
 * (auditoria "Admin Subscriptions V1", seção D). Por isso não existe coluna
 * "Origem" aqui: toda linha desta tabela é, por construção, uma assinatura
 * Stripe.
 *
 * V1 é estritamente READ-ONLY — nenhuma ação de cancelar/reativar/trocar
 * plano nesta etapa (ver auditoria, seção M). Os únicos links de saída são
 * para o Stripe Dashboard (navegação pura, sem SDK/chamada de API).
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { CreditCard, CheckCircle2, Clock, AlertCircle, Search, ExternalLink } from 'lucide-react'

import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { createSupabaseAdminSubscriptionsRepository } from '@/features/billing/repositories/admin-subscriptions.repository'
import type { AdminSubscriptionCurrencyFilter, AdminSubscriptionPlanFilter, AdminSubscriptionRow, AdminSubscriptionsSummary } from '@/features/billing/types'
import { planLabel, planBadgeTone } from '@/lib/plans/plan-display'
import { subscriptionStatusLabel, subscriptionStatusBadgeTone, subscriptionIntervalLabel } from '@/lib/stripe/subscription-status-display'
import { buildStripeCustomerDashboardUrl, buildStripeSubscriptionDashboardUrl } from '@/lib/stripe/dashboard-links'
import { formatPrice } from '@/lib/format/currency'
import { formatDateOnly, formatTimestampDate } from '@/lib/format/date'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'

const subscriptionsRepository = createSupabaseAdminSubscriptionsRepository()
const PAGE_SIZE = 50

const STATUS_OPTIONS = ['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'] as const

function toDateOnlyPart(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10)
}

/** `currency` vem do banco como `string | null` (bpchar convertido) — a checagem abaixo cobre o caso teoricamente impossível de uma moeda fora de BRL/USD (CHECK constraint) sem quebrar a tela. */
function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null || (currency !== 'BRL' && currency !== 'USD')) return '—'
  return formatPrice(amount, currency)
}

function formatCancellation(row: AdminSubscriptionRow): string {
  if (row.status === 'canceled' && row.canceledAt) {
    return `Cancelada em ${formatTimestampDate(row.canceledAt)}`
  }
  if (row.cancelAtPeriodEnd && row.currentPeriodEnd) {
    return `Agendado para ${formatDateOnly(toDateOnlyPart(row.currentPeriodEnd))}`
  }
  return '—'
}

export default function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | (typeof STATUS_OPTIONS)[number]>('all')
  const [planFilter, setPlanFilter] = useState<'all' | AdminSubscriptionPlanFilter>('all')
  const [currencyFilter, setCurrencyFilter] = useState<'all' | AdminSubscriptionCurrencyFilter>('all')
  const [cancelScheduledOnly, setCancelScheduledOnly] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState<AdminSubscriptionsSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // Encadeamento `.then()` (não async/await) de propósito — mesmo padrão já
  // usado em app/admin/members/page.tsx (`loadMembers`)/
  // app/dashboard/collection/page.tsx: evita react-hooks/set-state-in-effect
  // quando chamada diretamente pelo useEffect de filtros/página abaixo.
  const loadSubscriptions = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return subscriptionsRepository.listSubscriptions({
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          statusFilter: statusFilter === 'all' ? null : statusFilter,
          planFilter: planFilter === 'all' ? null : planFilter,
          currencyFilter: currencyFilter === 'all' ? null : currencyFilter,
          cancelScheduledOnly,
          search: search || null,
        })
      })
      .then((result) => {
        setSubscriptions(result.subscriptions)
        setTotalCount(result.totalCount)
      })
      .catch((err) => {
        setError(getUserFriendlyErrorMessage(err))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [page, statusFilter, planFilter, currencyFilter, cancelScheduledOnly, search])

  useEffect(() => {
    loadSubscriptions()
  }, [loadSubscriptions])

  useEffect(() => {
    subscriptionsRepository
      .getSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(getUserFriendlyErrorMessage(err)))
  }, [])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const hasActiveFilters = search !== '' || statusFilter !== 'all' || planFilter !== 'all' || currencyFilter !== 'all' || cancelScheduledOnly

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assinaturas"
        description="Assinaturas Stripe reais dos usuários — cortesias e a Conta de Análise têm suas próprias telas (Membros / Conta de Análise) e nunca aparecem aqui."
      />

      {summaryError ? (
        <ErrorState title="Não foi possível carregar o resumo" description={summaryError} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={CreditCard} label="Total de assinaturas" value={summary ? String(summary.totalSubscriptions) : '—'} />
          <StatCard icon={CheckCircle2} label="Ativas" value={summary ? String(summary.activeSubscriptions) : '—'} />
          <StatCard icon={Clock} label="Cancelando" value={summary ? String(summary.cancelingSubscriptions) : '—'} />
          <StatCard icon={AlertCircle} label="Falha de pagamento" value={summary ? String(summary.failedPaymentSubscriptions) : '—'} />
        </div>
      )}

      <Card className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:flex-wrap">
        <div className="flex-1 lg:min-w-[220px]">
          <Input
            label="Buscar"
            placeholder="Nome ou e-mail..."
            value={search}
            onChange={(event) => {
              setPage(0)
              setSearch(event.target.value)
            }}
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            label="Plano"
            value={planFilter}
            onChange={(event) => {
              setPage(0)
              setPlanFilter(event.target.value as 'all' | AdminSubscriptionPlanFilter)
            }}
          >
            <option value="all">Todos</option>
            <option value="pro">Pro</option>
            <option value="premium">Premium</option>
          </Select>
        </div>
        <div className="w-full sm:w-52">
          <Select
            label="Status"
            value={statusFilter}
            onChange={(event) => {
              setPage(0)
              setStatusFilter(event.target.value as 'all' | (typeof STATUS_OPTIONS)[number])
            }}
          >
            <option value="all">Todos</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {subscriptionStatusLabel(status)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-36">
          <Select
            label="Moeda"
            value={currencyFilter}
            onChange={(event) => {
              setPage(0)
              setCurrencyFilter(event.target.value as 'all' | AdminSubscriptionCurrencyFilter)
            }}
          >
            <option value="all">Todas</option>
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={cancelScheduledOnly}
            onChange={(event) => {
              setPage(0)
              setCancelScheduledOnly(event.target.checked)
            }}
            className="size-4 rounded border-border accent-accent"
          />
          Só com cancelamento agendado
        </label>
      </Card>

      {error ? (
        <ErrorState title="Não foi possível carregar as assinaturas" description={error} actionLabel="Tentar novamente" onAction={loadSubscriptions} />
      ) : !isLoading && subscriptions.length === 0 ? (
        <EmptyState
          icon={hasActiveFilters ? Search : CreditCard}
          title={hasActiveFilters ? 'Nenhuma assinatura encontrada' : 'Nenhuma assinatura Stripe ainda'}
          description={
            hasActiveFilters
              ? 'Ajuste a busca ou os filtros.'
              : 'Quando um usuário assinar Pro ou Premium via Stripe, a assinatura aparece aqui automaticamente.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Usuário</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Plano</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Ciclo</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Moeda</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Preço</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Início</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Próxima cobrança</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Cancelamento</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Última transação</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Stripe</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((row) => (
                  <tr key={row.subscriptionId} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 text-text-primary">
                      {row.userName ?? <span className="text-text-secondary">—</span>}
                      <p className="text-xs text-text-secondary">{row.userEmail ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={planBadgeTone(row.planSlug)}>{planLabel(row.planSlug)}</Badge>
                      {row.scheduledPlanSlug && (
                        <p className="mt-1 text-xs text-text-secondary">↓ {planLabel(row.scheduledPlanSlug)} agendado</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={subscriptionStatusBadgeTone(row.status)}>{subscriptionStatusLabel(row.status)}</Badge>
                      {row.trialEnd && <p className="mt-1 text-xs text-text-secondary">Trial até {formatTimestampDate(row.trialEnd)}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{subscriptionIntervalLabel(row.interval)}</td>
                    <td className="px-4 py-3 text-text-secondary">{row.currency ?? '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatAmount(row.amount, row.currency)}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatTimestampDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {row.currentPeriodEnd ? formatTimestampDate(row.currentPeriodEnd) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{formatCancellation(row)}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {row.lastTransactionStatus ? (
                        <>
                          {row.lastTransactionStatus === 'failed' ? (
                            <Badge tone="danger">Falhou</Badge>
                          ) : row.lastTransactionStatus === 'paid' ? (
                            <Badge tone="success">Paga</Badge>
                          ) : (
                            <Badge tone="neutral">{row.lastTransactionStatus}</Badge>
                          )}
                          {row.lastTransactionPaidAt && (
                            <p className="mt-1 text-xs text-text-secondary">{formatTimestampDate(row.lastTransactionPaidAt)}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {row.stripeCustomerId && (
                          <a
                            href={buildStripeCustomerDashboardUrl(row.stripeCustomerId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            {row.stripeCustomerIdMasked} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                        <a
                          href={buildStripeSubscriptionDashboardUrl(row.stripeSubscriptionId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          {row.stripeSubscriptionIdMasked} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-text-secondary">
              Página {page + 1} de {totalPages} · {totalCount} assinatura{totalCount === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 0 || isLoading} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button variant="secondary" size="sm" disabled={page + 1 >= totalPages || isLoading} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
