/**
 * lib/stripe/customer.ts
 * Etapa "Stripe 5.2 — Customer Foundation" — fundação segura e idempotente
 * do Stripe Customer. Server-only: recebe um client Supabase já
 * privilegiado (`service_role` — ver `lib/supabase/admin.ts`) e um client
 * Stripe já validado (TEST MODE, via `getStripeClient()`); nunca cria
 * nenhum dos dois aqui.
 *
 * `billing_customers` não tem NENHUMA policy de INSERT/UPDATE para usuário
 * comum (só `is_platform_owner()` — ver migration
 * `20260817110200_create_billing_customers.sql`) — por isso esta função só
 * pode ser chamada com um client `service_role`, nunca com o client de
 * sessão do usuário. O frontend nunca escolhe `stripe_customer_id`: quem
 * chama esta função decide `userId`/`email` a partir da sessão real
 * (nunca de input do chamador).
 *
 * CONCORRÊNCIA: duas requisições simultâneas para o mesmo usuário podem
 * ambas não encontrar uma linha local (TOCTOU) e ambas chamarem
 * `stripe.customers.create()`. A Idempotency-Key determinística
 * (`buildCreationIdempotencyKey('customer', userId)`) garante que o Stripe
 * devolve o MESMO Customer para as duas chamadas — a corrida real acontece
 * então só no INSERT local: `uq_billing_customers_user` (índice único)
 * rejeita a segunda tentativa com `23505`, tratado abaixo como "outra
 * requisição já venceu" (nunca como erro): relê a linha e devolve o
 * vínculo já persistido. Resultado: sempre exatamente 1 `billing_customer`
 * e 1 Stripe Customer por usuário, sem lock explícito — só a constraint já
 * existente + a idempotência do Stripe.
 *
 * FALHAS: se `stripe.customers.create()` lançar, nenhuma escrita local é
 * tentada (nunca um registro apontando para um Customer inexistente). Se o
 * INSERT falhar por um motivo que NÃO seja a corrida de unicidade acima, o
 * erro propaga — o Stripe Customer já criado fica órfão até uma nova
 * chamada (mesma Idempotency-Key ⇒ nenhum Customer duplicado é criado no
 * reprocessamento; eventualmente o INSERT persiste o vínculo). Stripe e
 * Postgres não compartilham uma transação — não existe rollback
 * cross-sistema, por isso o design inteiro depende de ser seguro reexecutar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { buildCreationIdempotencyKey } from './idempotency'

const UNIQUE_VIOLATION = '23505'

export interface GetOrCreateBillingCustomerParams {
  userId: string
  /** `null` quando o usuário não tem e-mail conhecido — nunca inventado. */
  email: string | null
}

export interface BillingCustomerResult {
  billingCustomerId: string
  stripeCustomerId: string
  /** `true` só quando ESTA chamada criou o Customer/vínculo — `false` em qualquer reaproveitamento. */
  created: boolean
}

interface BillingCustomerRow {
  id: string
  stripe_customer_id: string | null
}

async function findBillingCustomerByUserId(supabase: SupabaseClient, userId: string): Promise<BillingCustomerRow | null> {
  const { data, error } = await supabase.from('billing_customers').select('id, stripe_customer_id').eq('user_id', userId).maybeSingle()

  if (error) {
    throw new Error(`[getOrCreateBillingCustomer] Falha ao consultar billing_customers para user_id ${userId}: ${error.message}`)
  }

  return (data as BillingCustomerRow | null) ?? null
}

/**
 * `stripe_customer_id` é nullable no schema (linha pode em tese existir
 * "antes do Stripe" — ver comentário da migration original). Esta função
 * nunca preenche esse vazio silenciosamente: se encontrar uma linha nesse
 * estado, é uma inconsistência que exige investigação manual, nunca uma
 * decisão automática desta etapa (fora de escopo criar essa lógica agora).
 */
function requireStripeCustomerId(row: BillingCustomerRow): string {
  if (!row.stripe_customer_id) {
    throw new Error(
      `[getOrCreateBillingCustomer] billing_customers ${row.id} existe mas stripe_customer_id está vazio — estado inconsistente, requer investigação manual.`,
    )
  }
  return row.stripe_customer_id
}

export interface BillingCustomerByStripeIdResult {
  id: string
  userId: string
}

export interface TombstonedBillingCustomer {
  stripeCustomerId: string
  userId: string
  deletedAt: string
}

/**
 * Etapa "5.10F — Account Deletion x Async Stripe Webhook Race Fix":
 * `resolveBillingCustomerByStripeCustomerId` (abaixo) pode devolver este
 * resultado discriminado em vez de lançar — `kind: 'found'` é o caminho de
 * sempre; `kind: 'tombstoned'` só ocorre quando existe PROVA POSITIVA
 * (`deleted_billing_customers`) de que aquele `stripe_customer_id`
 * específico pertenceu a uma conta já removida por `delete_own_account_data`
 * — nunca uma suposição genérica de "não encontrado = ok".
 */
export type ResolveBillingCustomerOutcome =
  | { kind: 'found'; customer: BillingCustomerByStripeIdResult }
  | { kind: 'tombstoned'; tombstone: TombstonedBillingCustomer }

/**
 * Etapa "Stripe 5.4B/5.5" — resolução na direção OPOSTA de
 * `getOrCreateBillingCustomer` (Stripe Customer → billing_customer/user,
 * nunca cria nada, nunca aceita `user_id` de fora). Vive aqui (não em
 * `subscription-sync.ts`/`invoice-sync.ts`) porque os DOIS módulos
 * precisam da mesma resolução — evita tanto duplicar a lógica quanto um
 * import circular entre eles.
 *
 * Etapa "5.10F": quando `billing_customers` não tem o Customer (mais comum
 * caso: cancelamento de subscription durante a exclusão de conta, Etapa
 * 5.7, cujo webhook assíncrono `customer.subscription.deleted` pode chegar
 * DEPOIS de `delete_own_account_data` já ter removido a linha via cascade),
 * consulta `deleted_billing_customers` ANTES de lançar. Só quando esse
 * `stripe_customer_id` EXATO tem um tombstone, devolve `kind: 'tombstoned'`
 * — nunca uma associação a outro usuário, nunca um "não encontrado = OK"
 * genérico: qualquer Customer sem tombstone continua lançando exatamente
 * como antes (fail-closed inalterado para inconsistências reais).
 */
export async function resolveBillingCustomerByStripeCustomerId(supabase: SupabaseClient, stripeCustomerId: string): Promise<ResolveBillingCustomerOutcome> {
  const { data, error } = await supabase.from('billing_customers').select('id, user_id').eq('stripe_customer_id', stripeCustomerId).maybeSingle()

  if (error) {
    throw new Error(`[resolveBillingCustomerByStripeCustomerId] Falha ao consultar billing_customers para stripe_customer_id ${stripeCustomerId}: ${error.message}`)
  }
  if (data) {
    return { kind: 'found', customer: { id: data.id as string, userId: data.user_id as string } }
  }

  const { data: tombstone, error: tombstoneError } = await supabase
    .from('deleted_billing_customers')
    .select('stripe_customer_id, user_id, deleted_at')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle()

  if (tombstoneError) {
    throw new Error(`[resolveBillingCustomerByStripeCustomerId] Falha ao consultar deleted_billing_customers para stripe_customer_id ${stripeCustomerId}: ${tombstoneError.message}`)
  }
  if (tombstone) {
    return {
      kind: 'tombstoned',
      tombstone: { stripeCustomerId: tombstone.stripe_customer_id as string, userId: tombstone.user_id as string, deletedAt: tombstone.deleted_at as string },
    }
  }

  throw new Error(
    `[resolveBillingCustomerByStripeCustomerId] Stripe Customer ${stripeCustomerId} não tem billing_customer local vinculado (nem tombstone de exclusão) — inconsistência real, nunca associada a outro usuário arbitrariamente.`,
  )
}

export async function getOrCreateBillingCustomer(
  supabase: SupabaseClient,
  stripe: Stripe,
  params: GetOrCreateBillingCustomerParams,
): Promise<BillingCustomerResult> {
  const existing = await findBillingCustomerByUserId(supabase, params.userId)
  if (existing) {
    return { billingCustomerId: existing.id, stripeCustomerId: requireStripeCustomerId(existing), created: false }
  }

  const idempotencyKey = buildCreationIdempotencyKey('customer', params.userId)

  const customer = await stripe.customers.create(
    {
      email: params.email ?? undefined,
      metadata: { numora_user_id: params.userId },
    },
    { idempotencyKey },
  )

  const { data: inserted, error: insertError } = await supabase
    .from('billing_customers')
    .insert({ user_id: params.userId, stripe_customer_id: customer.id })
    .select('id')
    .single()

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      const winner = await findBillingCustomerByUserId(supabase, params.userId)
      if (!winner) {
        throw new Error(
          `[getOrCreateBillingCustomer] Conflito de unicidade em billing_customers.user_id (${params.userId}) mas nenhuma linha foi encontrada na releitura.`,
        )
      }
      return { billingCustomerId: winner.id, stripeCustomerId: requireStripeCustomerId(winner), created: false }
    }

    throw new Error(`[getOrCreateBillingCustomer] Falha ao persistir billing_customers para user_id ${params.userId}: ${insertError.message}`)
  }

  if (!inserted) {
    throw new Error(`[getOrCreateBillingCustomer] Insert em billing_customers não retornou dado para user_id ${params.userId}.`)
  }

  return { billingCustomerId: inserted.id as string, stripeCustomerId: customer.id, created: true }
}
