/**
 * features/billing/repositories/admin-transactions.repository.ts
 * Etapa "Admin Transactions V1" — única camada que conhece o nome da tabela
 * `billing_transactions`. Client de browser, mesmo padrão de
 * `features/admin/repositories/admin.repository.ts`.
 *
 * SEM RPC nova de propósito: `billing_transactions_select_admin` (RLS,
 * `is_platform_admin()`) já é a barreira real, e esta consulta não precisa
 * de nenhum cálculo/join que RLS+embed do PostgREST não resolvam sozinhos —
 * diferente de `admin_list_subscriptions()` (que precisa de LATERAL JOIN
 * para "última transação por assinatura", inviável só com embed). Se um
 * usuário sem a role chamar isto, as 3 policies admin
 * (`billing_transactions_select_admin`/`profiles_select_admin`/
 * `subscriptions_select_admin`) recusam cada uma independentemente — a UI
 * nunca é a barreira de segurança, só o banco.
 *
 * Embeds: `profiles(name,email)` via `user_id` (mesmo padrão de
 * `app/admin/audit/page.tsx`) e `subscriptions(stripe_subscription_id)` via
 * `subscription_id` — nunca expõe o UUID interno `subscription_id` na UI,
 * só o ID Stripe real (mascarado para texto, real para o link do Dashboard).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { maskStripeId } from '@/lib/format/mask-stripe-id'
import type {
  AdminTransactionRow,
  AdminTransactionsPage,
  AdminTransactionStatus,
  ListTransactionsParams,
} from '@/features/billing/types'

export interface AdminTransactionsRepository {
  listTransactions(params: ListTransactionsParams): Promise<AdminTransactionsPage>
}

interface BillingTransactionRow {
  id: string
  user_id: string
  amount: number | string | null
  currency: string | null
  status: AdminTransactionStatus
  created_at: string
  paid_at: string | null
  stripe_invoice_id: string | null
  stripe_payment_intent_id: string | null
  profiles: { name: string | null; email: string | null } | null
  subscriptions: { stripe_subscription_id: string } | null
}

const SELECT_COLUMNS =
  'id, user_id, amount, currency, status, created_at, paid_at, stripe_invoice_id, stripe_payment_intent_id, profiles(name, email), subscriptions(stripe_subscription_id)'

/** `numeric` do Postgres chega como `string` via supabase-js quando o valor não cabe com segurança em `number` — mesma normalização de `admin-subscriptions.repository.ts`, nunca inventa um valor quando a conversão falhar. */
function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toAdminTransactionRow(row: BillingTransactionRow): AdminTransactionRow {
  const stripeSubscriptionId = row.subscriptions?.stripe_subscription_id ?? null

  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.name ?? null,
    userEmail: row.profiles?.email ?? null,
    amount: toNullableNumber(row.amount),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeInvoiceIdMasked: maskStripeId(row.stripe_invoice_id),
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripePaymentIntentIdMasked: maskStripeId(row.stripe_payment_intent_id),
    stripeSubscriptionId,
    stripeSubscriptionIdMasked: maskStripeId(stripeSubscriptionId),
  }
}

export function createSupabaseAdminTransactionsRepository(): AdminTransactionsRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listTransactions({ limit = 50, offset = 0, statusFilter = null, currencyFilter = null }) {
      let query = supabase.from('billing_transactions').select(SELECT_COLUMNS, { count: 'exact' })

      if (statusFilter) {
        query = query.eq('status', statusFilter)
      }
      if (currencyFilter) {
        query = query.eq('currency', currencyFilter)
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        throw new Error(`[AdminTransactionsRepository] Falha ao listar transações: ${error.message}`)
      }

      const rows = (data ?? []) as unknown as BillingTransactionRow[]

      return {
        transactions: rows.map(toAdminTransactionRow),
        totalCount: count ?? 0,
      }
    },
  }
}
