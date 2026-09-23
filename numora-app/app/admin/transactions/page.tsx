/**
 * app/admin/transactions/page.tsx
 * Etapa "Admin Transactions V1" — primeira versão real de
 * `/admin/transactions`, substituindo o `AdminComingSoon`. Client Component,
 * mesmo padrão de `/admin/subscriptions` (filtros/paginação sem reload).
 *
 * FONTE ÚNICA: `public.billing_transactions`, via
 * `AdminTransactionsRepository` (query direta protegida por
 * `billing_transactions_select_admin`, sem RPC nova — ver comentário do
 * repository). V1 é estritamente READ-ONLY — nenhuma ação de reembolso/
 * edição nesta etapa. Os únicos links de saída são para o Stripe Dashboard
 * (navegação pura, sem SDK/chamada de API, nunca toca Stripe de verdade).
 *
 * Estado vazio: `billing_transactions` está vazia em DEV e Production
 * (nenhum pagamento real processado ainda) — o estado vazio abaixo é
 * honesto sobre isso, nunca mostra "R$0,00" como se fosse receita.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Receipt, ExternalLink } from 'lucide-react'

import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { createSupabaseAdminTransactionsRepository } from '@/features/billing/repositories/admin-transactions.repository'
import type { AdminTransactionCurrencyFilter, AdminTransactionRow, AdminTransactionStatus } from '@/features/billing/types'
import { buildStripeInvoiceDashboardUrl, buildStripePaymentIntentDashboardUrl, buildStripeSubscriptionDashboardUrl } from '@/lib/stripe/dashboard-links'
import { formatPrice } from '@/lib/format/currency'
import { formatTimestampDate } from '@/lib/format/date'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'

const transactionsRepository = createSupabaseAdminTransactionsRepository()
const PAGE_SIZE = 50

const STATUS_OPTIONS: AdminTransactionStatus[] = ['paid', 'pending', 'failed', 'refunded']

const STATUS_LABELS: Record<AdminTransactionStatus, string> = {
  paid: 'Paga',
  pending: 'Pendente',
  failed: 'Falhou',
  refunded: 'Reembolsada',
}

const STATUS_TONE: Record<AdminTransactionStatus, 'neutral' | 'accent' | 'success' | 'danger'> = {
  paid: 'success',
  pending: 'accent',
  failed: 'danger',
  refunded: 'neutral',
}

/** `currency` vem do banco como `string | null` — mesma checagem defensiva de `/admin/subscriptions` para nunca quebrar a tela com uma moeda fora de BRL/USD. */
function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null || (currency !== 'BRL' && currency !== 'USD')) return '—'
  return formatPrice(amount, currency)
}

export default function AdminTransactionsPage() {
  const [transactions, setTransactions] = useState<AdminTransactionRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'all' | AdminTransactionStatus>('all')
  const [currencyFilter, setCurrencyFilter] = useState<'all' | AdminTransactionCurrencyFilter>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Encadeamento `.then()` (não async/await) de propósito — mesmo padrão já
  // usado em app/admin/subscriptions/page.tsx (`loadSubscriptions`): evita
  // react-hooks/set-state-in-effect quando chamada diretamente pelo
  // useEffect de filtros/página abaixo.
  const loadTransactions = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return transactionsRepository.listTransactions({
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          statusFilter: statusFilter === 'all' ? null : statusFilter,
          currencyFilter: currencyFilter === 'all' ? null : currencyFilter,
        })
      })
      .then((result) => {
        setTransactions(result.transactions)
        setTotalCount(result.totalCount)
      })
      .catch((err) => {
        setError(getUserFriendlyErrorMessage(err))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [page, statusFilter, currencyFilter])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const hasActiveFilters = statusFilter !== 'all' || currencyFilter !== 'all'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transações"
        description="Histórico de pagamentos processados via Stripe — aparecem aqui automaticamente quando houver pagamentos reais."
      />

      <Card className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:flex-wrap">
        <div className="w-full sm:w-52">
          <Select
            label="Status"
            value={statusFilter}
            onChange={(event) => {
              setPage(0)
              setStatusFilter(event.target.value as 'all' | AdminTransactionStatus)
            }}
          >
            <option value="all">Todos</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
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
              setCurrencyFilter(event.target.value as 'all' | AdminTransactionCurrencyFilter)
            }}
          >
            <option value="all">Todas</option>
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
          </Select>
        </div>
      </Card>

      {error ? (
        <ErrorState title="Não foi possível carregar as transações" description={error} actionLabel="Tentar novamente" onAction={loadTransactions} />
      ) : !isLoading && transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={hasActiveFilters ? 'Nenhuma transação encontrada' : 'Não há transações registradas'}
          description={
            hasActiveFilters
              ? 'Ajuste os filtros.'
              : 'Transações aparecerão aqui quando houver pagamentos reais processados pelo Stripe.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Data</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Usuário</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Valor</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Moeda</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Invoice</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Payment Intent</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Subscription</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 text-text-secondary">{formatTimestampDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-text-primary">
                      {row.userName ?? <span className="text-text-secondary">—</span>}
                      <p className="text-xs text-text-secondary">{row.userEmail ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                      {row.paidAt && <p className="mt-1 text-xs text-text-secondary">Paga em {formatTimestampDate(row.paidAt)}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{formatAmount(row.amount, row.currency)}</td>
                    <td className="px-4 py-3 text-text-secondary">{row.currency ?? '—'}</td>
                    <td className="px-4 py-3">
                      {row.stripeInvoiceId ? (
                        <a
                          href={buildStripeInvoiceDashboardUrl(row.stripeInvoiceId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          {row.stripeInvoiceIdMasked} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.stripePaymentIntentId ? (
                        <a
                          href={buildStripePaymentIntentDashboardUrl(row.stripePaymentIntentId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          {row.stripePaymentIntentIdMasked} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.stripeSubscriptionId ? (
                        <a
                          href={buildStripeSubscriptionDashboardUrl(row.stripeSubscriptionId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          {row.stripeSubscriptionIdMasked} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-text-secondary">
              Página {page + 1} de {totalPages} · {totalCount} transaç{totalCount === 1 ? 'ão' : 'ões'}
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
