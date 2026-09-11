/**
 * tests/integration/account-deletion-webhook-race.test.ts
 * Etapa "5.10F — Account Deletion x Async Stripe Webhook Race Fix" — prova,
 * contra Supabase DEV real + Stripe TEST real, que um webhook chegando
 * DEPOIS da exclusão de conta (mesmo cenário observado no 5.10E: Checkout
 * real → exclusão de conta real → `customer.subscription.deleted`
 * assíncrono chegando minutos depois, quando `billing_customers` já não
 * existe mais) termina `processed`, nunca `failed` — porque
 * `delete_own_account_data` grava um tombstone em
 * `deleted_billing_customers` ANTES do cascade, e
 * `resolveBillingCustomerByStripeCustomerId` consulta esse tombstone antes
 * de lançar (nunca um "não encontrado = sucesso" genérico).
 *
 * Reproduz a MESMA sequência de exclusão de `app/api/account/delete/route.ts`
 * (mesmo padrão já usado em `tests/integration/stripe-account-deletion.test.ts`)
 * e o MESMO padrão de simulação de webhook (evento sintético + pipeline
 * real) já usado em `tests/integration/stripe-webhook-foundation.test.ts`.
 *
 * ZERO Product/Price oficial é tocado. Customers/Subscriptions de teste são
 * limpos em `afterAll` (best-effort). Linhas de `deleted_billing_customers`
 * e `billing_webhook_events` criadas por esta suíte são removidas
 * explicitamente — a tabela em si nunca é limpa por código de aplicação
 * (retenção é decisão de produto, fora de escopo desta etapa).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { cancelAllStripeSubscriptionsForAccountDeletion } from '@/lib/stripe/subscription-management'
import { syncFromRecognizedWebhookEvent, type SkippedSyncResult } from '@/lib/stripe/subscription-sync'
import { decideWebhookAction, dispatchWebhookEvent, markWebhookEventFailed, markWebhookEventProcessed, recordWebhookEvent } from '@/lib/stripe/webhook'
import { createAdminClient, createDisposableUser, getTestEnv, hasTestEnv, type TestEnv } from '../support/dev-env'

const BAN_DURATION = '876000h'

describe.skipIf(!hasTestEnv())('Account deletion x async Stripe webhook race (DEV real + Stripe TEST real) — Etapa 5.10F', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  let proMonthBrlPriceId: string
  const createdStripeCustomerIds = new Set<string>()
  const insertedWebhookEventIds = new Set<string>()
  const trackedTombstoneCustomerIds = new Set<string>()

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()

    const { data } = await admin.from('plan_prices').select('stripe_price_id, plans:plan_id(slug)').eq('interval', 'month').eq('currency', 'BRL').eq('active', true)
    for (const row of data ?? []) {
      const slug = Array.isArray(row.plans) ? row.plans[0]?.slug : (row.plans as { slug: string } | null)?.slug
      if (slug === 'pro') proMonthBrlPriceId = row.stripe_price_id as string
    }
  })

  afterAll(async () => {
    await Promise.allSettled(
      Array.from(createdStripeCustomerIds).map(async (id) => {
        try {
          const subs = await stripe.subscriptions.list({ customer: id, status: 'all' })
          await Promise.allSettled(subs.data.filter((s) => s.status !== 'canceled').map((s) => stripe.subscriptions.cancel(s.id).catch(() => undefined)))
          await stripe.customers.del(id)
        } catch {
          // best-effort
        }
      }),
    )
    if (insertedWebhookEventIds.size > 0) {
      await admin.from('billing_webhook_events').delete().in('stripe_event_id', Array.from(insertedWebhookEventIds))
    }
    if (trackedTombstoneCustomerIds.size > 0) {
      await admin.from('deleted_billing_customers').delete().in('stripe_customer_id', Array.from(trackedTombstoneCustomerIds))
    }
  }, 60_000)

  /** Reproduz a sequência real de exclusão a partir do ponto em que a rota já resolveu `userId`/`adminClient`/`stripe` — mesmo helper de `stripe-account-deletion.test.ts`. */
  async function runAccountDeletionSequence(userId: string): Promise<void> {
    await cancelAllStripeSubscriptionsForAccountDeletion(admin, () => stripe, userId)
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION })
    if (banError) throw banError
    const { error: rpcError } = await admin.rpc('delete_own_account_data', { p_user_id: userId })
    if (rpcError) throw rpcError
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
    if (deleteUserError && deleteUserError.status !== 404) throw deleteUserError
  }

  async function setupUserWithRealSubscription(label: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)
    trackedTombstoneCustomerIds.add(billingCustomer.stripeCustomerId)

    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: billingCustomer.stripeCustomerId })
    await stripe.customers.update(billingCustomer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: proMonthBrlPriceId }] })

    return { user, stripeCustomerId: billingCustomer.stripeCustomerId, subscription }
  }

  /** Evento SINTÉTICO (payload fabricado aqui, nunca vindo de uma entrega real do Stripe) — mesmo padrão de stripe-webhook-foundation.test.ts. `syncFromRecognizedWebhookEvent` sempre busca o estado CANÔNICO via retrieve(), então só o `id` do objeto referenciado precisa ser real. */
  function makeLateEvent(type: string, objectId: string): Stripe.Event {
    const id = `evt_test_5_10f_${crypto.randomUUID()}`
    insertedWebhookEventIds.add(id)
    return { id, object: 'event', type, data: { object: { id: objectId } } } as unknown as Stripe.Event
  }

  it('customer.subscription.deleted chegando DEPOIS da exclusão de conta: termina "processed", nunca "failed"', async () => {
    const { user, stripeCustomerId, subscription } = await setupUserWithRealSubscription('webhook-race-sub-deleted')

    await runAccountDeletionSequence(user.id)

    // Confirma que o tombstone foi gravado (prova positiva exigida pela solução).
    const { data: tombstone } = await admin.from('deleted_billing_customers').select('stripe_customer_id, user_id, deleted_at').eq('stripe_customer_id', stripeCustomerId).maybeSingle()
    expect(tombstone).not.toBeNull()
    expect(tombstone!.user_id).toBe(user.id)

    // Confirma que billing_customers realmente não existe mais (a corrida só é real se isso for verdade).
    const { data: billingCustomerAfter } = await admin.from('billing_customers').select('id').eq('stripe_customer_id', stripeCustomerId).maybeSingle()
    expect(billingCustomerAfter).toBeNull()

    // Simula a entrega TARDIA do webhook (o cancelamento real já aconteceu em runAccountDeletionSequence acima).
    const event = makeLateEvent('customer.subscription.deleted', subscription.id)
    const record = await recordWebhookEvent(admin, event)
    expect(decideWebhookAction(record)).toBe('process')
    expect(dispatchWebhookEvent(event).recognized).toBe(true)

    let syncResult: Awaited<ReturnType<typeof syncFromRecognizedWebhookEvent>>
    try {
      syncResult = await syncFromRecognizedWebhookEvent(admin, stripe, event)
      await markWebhookEventProcessed(admin, record.id)
    } catch (err) {
      await markWebhookEventFailed(admin, record.id, err instanceof Error ? err.message : 'erro desconhecido')
      throw err
    }

    expect(syncResult).toEqual<SkippedSyncResult>({ outcome: 'skipped', reason: expect.stringContaining(stripeCustomerId) })

    const { data: row } = await admin.from('billing_webhook_events').select('status, error').eq('stripe_event_id', event.id).single()
    expect(row?.status).toBe('processed')
    expect(row?.error).toBeNull()
  }, 30_000)

  it('regressão: Stripe Customer NUNCA conhecido localmente (sem billing_customer, sem tombstone) continua "failed"', async () => {
    // Customer/subscription criados DIRETO no Stripe (nunca via getOrCreateBillingCustomer)
    // — nunca existiu localmente, nem em billing_customers nem em deleted_billing_customers.
    const customer = await stripe.customers.create({ email: `numora.5.10f.never-known.${Date.now()}@example.com` })
    createdStripeCustomerIds.add(customer.id)
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id })
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: proMonthBrlPriceId }] })

    const event = makeLateEvent('customer.subscription.deleted', subscription.id)
    const record = await recordWebhookEvent(admin, event)

    await expect(syncFromRecognizedWebhookEvent(admin, stripe, event)).rejects.toThrow(/não tem billing_customer local vinculado \(nem tombstone de exclusão\)/)

    await markWebhookEventFailed(admin, record.id, 'customer nunca conhecido (teste de regressão 5.10F)')
    const { data: row } = await admin.from('billing_webhook_events').select('status').eq('stripe_event_id', event.id).single()
    expect(row?.status).toBe('failed')
  }, 30_000)

  it('invoice.paid tardio para customer tombstoned: termina "processed", nunca "failed"', async () => {
    const { user, stripeCustomerId, subscription } = await setupUserWithRealSubscription('webhook-race-invoice-paid')
    const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id
    if (!invoiceId) throw new Error('subscription sem latest_invoice — setup inválido para este teste')

    await runAccountDeletionSequence(user.id)

    const event = makeLateEvent('invoice.paid', invoiceId)
    const record = await recordWebhookEvent(admin, event)

    let syncResult: Awaited<ReturnType<typeof syncFromRecognizedWebhookEvent>>
    try {
      syncResult = await syncFromRecognizedWebhookEvent(admin, stripe, event)
      await markWebhookEventProcessed(admin, record.id)
    } catch (err) {
      await markWebhookEventFailed(admin, record.id, err instanceof Error ? err.message : 'erro desconhecido')
      throw err
    }

    expect(syncResult).toEqual<SkippedSyncResult>({ outcome: 'skipped', reason: expect.stringContaining(stripeCustomerId) })

    const { data: row } = await admin.from('billing_webhook_events').select('status').eq('stripe_event_id', event.id).single()
    expect(row?.status).toBe('processed')
  }, 30_000)

  it('invoice.payment_failed tardio para customer tombstoned: termina "processed", nunca "failed"', async () => {
    const { user, stripeCustomerId, subscription } = await setupUserWithRealSubscription('webhook-race-invoice-failed')
    const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id
    if (!invoiceId) throw new Error('subscription sem latest_invoice — setup inválido para este teste')

    await runAccountDeletionSequence(user.id)

    const event = makeLateEvent('invoice.payment_failed', invoiceId)
    const record = await recordWebhookEvent(admin, event)

    let syncResult: Awaited<ReturnType<typeof syncFromRecognizedWebhookEvent>>
    try {
      syncResult = await syncFromRecognizedWebhookEvent(admin, stripe, event)
      await markWebhookEventProcessed(admin, record.id)
    } catch (err) {
      await markWebhookEventFailed(admin, record.id, err instanceof Error ? err.message : 'erro desconhecido')
      throw err
    }

    expect(syncResult).toEqual<SkippedSyncResult>({ outcome: 'skipped', reason: expect.stringContaining(stripeCustomerId) })

    const { data: row } = await admin.from('billing_webhook_events').select('status').eq('stripe_event_id', event.id).single()
    expect(row?.status).toBe('processed')
  }, 30_000)
})
