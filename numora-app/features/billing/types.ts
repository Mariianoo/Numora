/**
 * features/billing/types.ts
 * Tipagens de domínio do billing administrativo (Admin Subscriptions V1).
 *
 * `AdminSubscriptionRow` representa uma linha de `public.subscriptions`
 * REAL — nunca uma cortesia (`benefit_grants`) nem a Conta de Análise
 * (`internal_test_accounts`), que têm suas próprias telas
 * (`/admin/members`, `/admin/analysis-account`) e nunca aparecem aqui (ver
 * `admin_list_subscriptions()`, que nunca lê essas tabelas).
 */

export type AdminSubscriptionPlanFilter = 'pro' | 'premium'
export type AdminSubscriptionCurrencyFilter = 'BRL' | 'USD'

export interface AdminSubscriptionRow {
  subscriptionId: string
  userId: string
  userName: string | null
  userEmail: string | null
  planSlug: string
  status: string
  interval: string | null
  currency: string | null
  amount: number | null
  createdAt: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  /** `null` = sem trial (a maioria das assinaturas) — nunca inventar uma data. */
  trialEnd: string | null
  /** Downgrade agendado (Stripe Subscription Schedule) — `null` = nenhum agendado. */
  scheduledPlanSlug: string | null
  /** ID REAL — usar para montar o `href` do link do Stripe Dashboard, nunca para exibir em texto. */
  stripeCustomerId: string | null
  /** Versão mascarada de `stripeCustomerId`, pronta para exibição em texto. */
  stripeCustomerIdMasked: string
  /** ID REAL — usar para montar o `href` do link do Stripe Dashboard, nunca para exibir em texto. */
  stripeSubscriptionId: string
  /** Versão mascarada de `stripeSubscriptionId`, pronta para exibição em texto. */
  stripeSubscriptionIdMasked: string
  lastTransactionStatus: string | null
  lastTransactionPaidAt: string | null
}

export interface AdminSubscriptionsPage {
  subscriptions: AdminSubscriptionRow[]
  totalCount: number
}

export interface ListSubscriptionsParams {
  limit?: number
  offset?: number
  statusFilter?: string | null
  planFilter?: AdminSubscriptionPlanFilter | null
  currencyFilter?: AdminSubscriptionCurrencyFilter | null
  cancelScheduledOnly?: boolean
  search?: string | null
}

export interface AdminSubscriptionsSummary {
  totalSubscriptions: number
  activeSubscriptions: number
  cancelingSubscriptions: number
  failedPaymentSubscriptions: number
}

/**
 * Etapa "Admin Transactions V1" — `AdminTransactionRow` representa uma linha
 * de `public.billing_transactions` REAL — fonte única, nunca uma segunda
 * verdade. `status` é exatamente o CHECK da tabela (`paid`/`failed`/
 * `pending`/`refunded`), nunca um valor inventado.
 */
export type AdminTransactionStatus = 'paid' | 'failed' | 'pending' | 'refunded'
export type AdminTransactionCurrencyFilter = 'BRL' | 'USD'

export interface AdminTransactionRow {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  amount: number | null
  currency: string | null
  status: AdminTransactionStatus
  createdAt: string
  paidAt: string | null
  /** ID REAL — usar para montar o `href` do link do Stripe Dashboard, nunca para exibir em texto. */
  stripeInvoiceId: string | null
  /** Versão mascarada de `stripeInvoiceId`, pronta para exibição em texto. */
  stripeInvoiceIdMasked: string
  /** ID REAL — usar para montar o `href` do link do Stripe Dashboard, nunca para exibir em texto. */
  stripePaymentIntentId: string | null
  /** Versão mascarada de `stripePaymentIntentId`, pronta para exibição em texto. */
  stripePaymentIntentIdMasked: string
  /** `null` = transação sem assinatura vinculada (subscription_id é opcional no schema) — nunca inventar uma. ID REAL do Stripe (nunca o UUID interno `subscription_id`), para o link do Stripe Dashboard. */
  stripeSubscriptionId: string | null
  /** Versão mascarada de `stripeSubscriptionId`. */
  stripeSubscriptionIdMasked: string
}

export interface AdminTransactionsPage {
  transactions: AdminTransactionRow[]
  totalCount: number
}

export interface ListTransactionsParams {
  limit?: number
  offset?: number
  statusFilter?: AdminTransactionStatus | null
  currencyFilter?: AdminTransactionCurrencyFilter | null
}
