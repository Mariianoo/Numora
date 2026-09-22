/**
 * features/billing/repositories/admin-subscriptions.repository.ts
 * Etapa "Admin Subscriptions V1" — única camada que conhece os nomes das
 * RPCs administrativas de assinatura. Client de browser, mesmo padrão de
 * `features/admin/repositories/admin.repository.ts`.
 *
 * Toda autorização já é garantida no banco (`is_platform_admin()` dentro de
 * `admin_list_subscriptions()`/`admin_subscriptions_summary()`) — este
 * repository não faz NENHUMA checagem de role em código: se um usuário sem
 * a role chamar qualquer método daqui, o Postgres recusa (RPC lança 42501).
 * A UI nunca é a barreira de segurança, só o banco.
 *
 * NUNCA lê `benefit_grants`/`internal_test_accounts` diretamente — a fonte
 * é exclusivamente `admin_list_subscriptions()`, que já garante isso (ver
 * `tests/unit/admin-subscriptions-migration-regression.test.ts`).
 *
 * Nenhum SQL aqui — só chamada de RPC + mapeamento de tipos + masking dos
 * IDs Stripe para exibição (o ID REAL nunca é descartado, sempre disponível
 * ao lado da versão mascarada, para os links do Stripe Dashboard).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { maskStripeId } from '@/lib/format/mask-stripe-id'
import type { AdminSubscriptionRow, AdminSubscriptionsPage, AdminSubscriptionsSummary, ListSubscriptionsParams } from '@/features/billing/types'

export interface AdminSubscriptionsRepository {
  listSubscriptions(params: ListSubscriptionsParams): Promise<AdminSubscriptionsPage>
  getSummary(): Promise<AdminSubscriptionsSummary>
}

interface AdminListSubscriptionsRpcRow {
  subscription_id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  plan_slug: string
  status: string
  interval: string | null
  currency: string | null
  amount: number | string | null
  created_at: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  trial_end: string | null
  scheduled_plan_slug: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string
  last_transaction_status: string | null
  last_transaction_paid_at: string | null
  total_count: number
}

interface AdminSubscriptionsSummaryRpcRow {
  total_subscriptions: number
  active_subscriptions: number
  canceling_subscriptions: number
  failed_payment_subscriptions: number
}

/** `numeric` do Postgres chega como `string` via supabase-js quando o valor não cabe com segurança em `number` — normaliza para `number | null` sem nunca inventar um valor quando a conversão falhar. */
function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toAdminSubscriptionRow(row: AdminListSubscriptionsRpcRow): AdminSubscriptionRow {
  return {
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    planSlug: row.plan_slug,
    status: row.status,
    interval: row.interval,
    currency: row.currency,
    amount: toNullableNumber(row.amount),
    createdAt: row.created_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    trialEnd: row.trial_end,
    scheduledPlanSlug: row.scheduled_plan_slug,
    stripeCustomerId: row.stripe_customer_id,
    stripeCustomerIdMasked: maskStripeId(row.stripe_customer_id),
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeSubscriptionIdMasked: maskStripeId(row.stripe_subscription_id),
    lastTransactionStatus: row.last_transaction_status,
    lastTransactionPaidAt: row.last_transaction_paid_at,
  }
}

export function createSupabaseAdminSubscriptionsRepository(): AdminSubscriptionsRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listSubscriptions({ limit = 50, offset = 0, statusFilter = null, planFilter = null, currencyFilter = null, cancelScheduledOnly = false, search = null }) {
      const { data, error } = await supabase.rpc('admin_list_subscriptions', {
        p_limit: limit,
        p_offset: offset,
        p_status_filter: statusFilter,
        p_plan_filter: planFilter,
        p_currency_filter: currencyFilter,
        p_cancel_scheduled_only: cancelScheduledOnly,
        p_search: search && search.trim() !== '' ? search.trim() : null,
      })

      if (error) {
        throw new Error(`[AdminSubscriptionsRepository] Falha ao listar assinaturas: ${error.message}`)
      }

      const rows = (data ?? []) as AdminListSubscriptionsRpcRow[]

      return {
        subscriptions: rows.map(toAdminSubscriptionRow),
        totalCount: rows[0]?.total_count ?? 0,
      }
    },

    async getSummary() {
      const { data, error } = await supabase.rpc('admin_subscriptions_summary').maybeSingle()

      if (error) {
        throw new Error(`[AdminSubscriptionsRepository] Falha ao consultar o resumo de assinaturas: ${error.message}`)
      }

      const row = data as AdminSubscriptionsSummaryRpcRow | null

      return {
        totalSubscriptions: row?.total_subscriptions ?? 0,
        activeSubscriptions: row?.active_subscriptions ?? 0,
        cancelingSubscriptions: row?.canceling_subscriptions ?? 0,
        failedPaymentSubscriptions: row?.failed_payment_subscriptions ?? 0,
      }
    },
  }
}
