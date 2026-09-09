/**
 * tests/integration/stripe-invoice-sync.test.ts
 * Etapa "Stripe 5.5 — Invoice & Payment Sync" — prova, contra Supabase DEV
 * real E Stripe TEST MODE real, que `syncInvoicePaid`/`syncInvoicePaymentFailed`
 * sincronizam corretamente `billing_transactions` a partir de invoices
 * REAIS do Stripe TEST.
 *
 * Subscriptions são criadas DIRETO via `stripe.subscriptions.create()` —
 * igual ao padrão já usado em tests/integration/stripe-subscription-sync.test.ts
 * (Stripe 5.4B). O cenário de sucesso usa o payment method de teste oficial
 * do Stripe (`pm_card_visa`); o cenário de falha cria a subscription SEM
 * nenhum payment method associado ao Customer (`payment_behavior:
 * 'default_incomplete'`) — o Stripe gera um invoice real que nunca chega a
 * ser cobrado (nenhuma tentativa de cobrança é feita, não uma cobrança
 * recusada por cartão), suficiente para validar `invoice.payment_failed`.
 * Isso gera invoices genuinamente reais em TEST MODE, sem precisar
 * completar Checkout no browser a cada teste.
 *
 * ZERO subscription/Customer/Price/Product oficial é alterado — todo
 * recurso criado aqui é de teste, registrado e limpo em `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { syncInvoicePaid, syncInvoicePaymentFailed } from '@/lib/stripe/invoice-sync'
import { syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'
import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  signInAsDisposableUser,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'

describe.skipIf(!hasTestEnv())('Invoice & Payment sync (DEV real + Stripe TEST real) — Stripe 5.5', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  let proMonthBrlPriceId: string
  const createdStripeCustomerIds = new Set<string>()
  const createdStripeSubscriptionIds = new Set<string>()

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
    await Promise.allSettled(Array.from(createdStripeSubscriptionIds).map((id) => stripe.subscriptions.cancel(id).catch(() => undefined)))
    await Promise.allSettled(Array.from(createdStripeCustomerIds).map((id) => stripe.customers.del(id).catch(() => undefined)))
  }, 60_000)

  async function setupUserWithRealCustomer(label: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)
    return { user, stripeCustomerId: billingCustomer.stripeCustomerId }
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('billing_transactions').delete().eq('user_id', user.id)
    await admin.from('subscriptions').delete().eq('user_id', user.id)
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  async function createSuccessfulSubscription(stripeCustomerId: string) {
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomerId })
    await stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: stripeCustomerId, items: [{ price: proMonthBrlPriceId }] })
    createdStripeSubscriptionIds.add(subscription.id)
    return subscription
  }

  /**
   * Cenário "failed" real sem depender de simular uma recusa de cobrança:
   * `4000000000000341` (o cartão de teste oficial do Stripe para "attach
   * funciona, cobrança falha") exige acesso à API de dados brutos de
   * cartão, desabilitado por padrão nesta conta — e `pm_card_chargeDeclined`
   * falha já no `attach` (inútil aqui). Em vez disso: cria a subscription
   * com `payment_behavior: 'default_incomplete'` e SEM nenhum payment
   * method associado ao Customer — o Stripe gera um invoice real, genuíno,
   * que nunca é cobrado com sucesso (subscription fica `incomplete`). Para
   * o que este arquivo testa (extração de amount_due/customer/subscription/
   * ausência de payment_intent a partir de um invoice real não pago), o
   * resultado é equivalente a uma cobrança que falhou.
   */
  async function createFailingSubscription(stripeCustomerId: string) {
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: proMonthBrlPriceId }],
      payment_behavior: 'default_incomplete',
    })
    createdStripeSubscriptionIds.add(subscription.id)
    return subscription
  }

  async function latestInvoiceId(stripeSubscriptionId: string): Promise<string> {
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id
    if (!invoiceId) throw new Error('subscription sem latest_invoice')
    return invoiceId
  }

  describe('FASE 8 — invoice.paid (real)', () => {
    it('1) cria a transação corretamente: paid, valor/currency corretos, payment_intent presente', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const result = await syncInvoicePaid(admin, stripe, invoiceId)
        expect(result.outcome).toBe('synced')
        expect(result.newStatus).toBe('paid')

        const { data: row } = await admin
          .from('billing_transactions')
          .select('user_id, stripe_invoice_id, stripe_payment_intent_id, amount, currency, status, paid_at, subscription_id')
          .eq('stripe_invoice_id', invoiceId)
          .single()

        expect(row?.user_id).toBe(user.id)
        expect(Number(row?.amount)).toBe(19.9)
        expect(row?.currency.trim()).toBe('BRL')
        expect(row?.status).toBe('paid')
        expect(row?.paid_at).not.toBeNull()
        expect(row?.stripe_payment_intent_id).not.toBeNull()
      } finally {
        await teardownUser(user)
      }
    })

    it('7) subscription local já sincronizada: subscription_id é associado corretamente', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid-with-sub')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        const syncedSub = await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_invoice_with_sub')
        const invoiceId = await latestInvoiceId(subscription.id)

        await syncInvoicePaid(admin, stripe, invoiceId)

        const { data: row } = await admin.from('billing_transactions').select('subscription_id').eq('stripe_invoice_id', invoiceId).single()
        expect(row?.subscription_id).toBe(syncedSub.subscriptionId)
      } finally {
        await teardownUser(user)
      }
    })

    it('8) subscription Stripe existe mas AINDA não foi sincronizada localmente: invoice é registrado com subscription_id=null', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid-no-local-sub')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        // Nunca chama syncSubscriptionFromStripe aqui de propósito.
        const invoiceId = await latestInvoiceId(subscription.id)

        const result = await syncInvoicePaid(admin, stripe, invoiceId)
        expect(result.outcome).toBe('synced')

        const { data: row } = await admin.from('billing_transactions').select('subscription_id').eq('stripe_invoice_id', invoiceId).single()
        expect(row?.subscription_id).toBeNull()
      } finally {
        await teardownUser(user)
      }
    })

    it('retry do mesmo evento não duplica: mesma linha, mesmo transaction_id', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid-retry')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const first = await syncInvoicePaid(admin, stripe, invoiceId)
        const second = await syncInvoicePaid(admin, stripe, invoiceId)

        expect(second.transactionId).toBe(first.transactionId)
        const { data: rows } = await admin.from('billing_transactions').select('id').eq('stripe_invoice_id', invoiceId)
        expect(rows).toHaveLength(1)
      } finally {
        await teardownUser(user)
      }
    })

    it('11) 2 sincronizações CONCORRENTES do mesmo invoice.paid: 1 linha final, nenhuma duplicação', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid-concurrency')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const [a, b] = await Promise.all([syncInvoicePaid(admin, stripe, invoiceId), syncInvoicePaid(admin, stripe, invoiceId)])
        expect(a.transactionId).toBe(b.transactionId)

        const { data: rows } = await admin.from('billing_transactions').select('id').eq('stripe_invoice_id', invoiceId)
        expect(rows).toHaveLength(1)
      } finally {
        await teardownUser(user)
      }
    })

    it('Customer inexistente localmente: falha explícita, nada é persistido', async () => {
      const orphanCustomer = await stripe.customers.create({ email: `numora.test.invoice-orphan.${Date.now()}@example.com` })
      createdStripeCustomerIds.add(orphanCustomer.id)
      const subscription = await createSuccessfulSubscription(orphanCustomer.id)
      const invoiceId = await latestInvoiceId(subscription.id)

      await expect(syncInvoicePaid(admin, stripe, invoiceId)).rejects.toThrow(/não tem billing_customer local vinculado/)

      const { data: rows } = await admin.from('billing_transactions').select('id').eq('stripe_invoice_id', invoiceId)
      expect(rows).toEqual([])
    })

    it('metadata.numora_user_id incompatível: falha explícita, nunca associa ao usuário errado', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid-bad-metadata')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)
        await stripe.invoices.update(invoiceId, { metadata: { numora_user_id: '00000000-0000-0000-0000-000000000000' } })

        await expect(syncInvoicePaid(admin, stripe, invoiceId)).rejects.toThrow(/Inconsistência/)

        const { data: rows } = await admin.from('billing_transactions').select('id').eq('stripe_invoice_id', invoiceId)
        expect(rows).toEqual([])
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 9 — invoice.payment_failed (real)', () => {
    it('2) cria a transação corretamente: failed, paid_at null, valor = amount_due', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-failed')
      try {
        const subscription = await createFailingSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const result = await syncInvoicePaymentFailed(admin, stripe, invoiceId)
        expect(result.newStatus).toBe('failed')

        const { data: row } = await admin.from('billing_transactions').select('status, paid_at, user_id, amount').eq('stripe_invoice_id', invoiceId).single()
        expect(row?.status).toBe('failed')
        expect(row?.paid_at).toBeNull()
        expect(row?.user_id).toBe(user.id)
        expect(Number(row?.amount)).toBe(19.9)

        // FASE 9 — nunca altera o status da subscription automaticamente.
        const { data: subRows } = await admin.from('subscriptions').select('id').eq('stripe_subscription_id', subscription.id)
        expect(subRows).toEqual([]) // ninguém sincronizou a subscription nesta etapa — permanece assim
      } finally {
        await teardownUser(user)
      }
    })

    it('6) failed → failed (retry) não duplica', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-failed-retry')
      try {
        const subscription = await createFailingSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const first = await syncInvoicePaymentFailed(admin, stripe, invoiceId)
        const second = await syncInvoicePaymentFailed(admin, stripe, invoiceId)
        expect(second.transactionId).toBe(first.transactionId)

        const { data: rows } = await admin.from('billing_transactions').select('id').eq('stripe_invoice_id', invoiceId)
        expect(rows).toHaveLength(1)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 4/12 — failed → paid (mesmo invoice, nunca 2 linhas) e proteção contra rebaixamento', () => {
    it('failed seguido de paid (retry de pagamento bem-sucedido) atualiza a MESMA linha para paid', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-failed-then-paid')
      try {
        const subscription = await createFailingSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const failedResult = await syncInvoicePaymentFailed(admin, stripe, invoiceId)
        expect(failedResult.newStatus).toBe('failed')

        // Corrige o payment method para um que funciona e reprocessa o pagamento do MESMO invoice.
        const goodPm = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomerId })
        await stripe.invoices.pay(invoiceId, { payment_method: goodPm.id })

        const paidResult = await syncInvoicePaid(admin, stripe, invoiceId)
        expect(paidResult.transactionId).toBe(failedResult.transactionId) // MESMA linha
        expect(paidResult.previousStatus).toBe('failed')
        expect(paidResult.newStatus).toBe('paid')

        const { data: rows } = await admin.from('billing_transactions').select('id, status, paid_at').eq('stripe_invoice_id', invoiceId)
        expect(rows).toHaveLength(1)
        expect(rows![0].status).toBe('paid')
        expect(rows![0].paid_at).not.toBeNull()
      } finally {
        await teardownUser(user)
      }
    })

    it('paid seguido de um payment_failed tardio/duplicado NUNCA rebaixa a transação já paga', async () => {
      const { user, stripeCustomerId } = await setupUserWithRealCustomer('invoice-paid-then-late-failed')
      try {
        const subscription = await createSuccessfulSubscription(stripeCustomerId)
        const invoiceId = await latestInvoiceId(subscription.id)

        const paidResult = await syncInvoicePaid(admin, stripe, invoiceId)
        expect(paidResult.newStatus).toBe('paid')

        // Simula uma entrega tardia/fora de ordem de invoice.payment_failed para o MESMO invoice já pago.
        const lateFailedResult = await syncInvoicePaymentFailed(admin, stripe, invoiceId)
        expect(lateFailedResult.newStatus).toBe('paid') // protegido — nunca rebaixado

        const { data: row } = await admin.from('billing_transactions').select('status, paid_at').eq('stripe_invoice_id', invoiceId).single()
        expect(row?.status).toBe('paid')
        expect(row?.paid_at).not.toBeNull()
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 14 — RLS não foi enfraquecida', () => {
    it('usuário comum não escreve em billing_transactions diretamente', async () => {
      const user = await createDisposableUser(admin, 'invoice-rls')
      try {
        const userClient = await signInAsDisposableUser(env, user)
        const { error } = await userClient.from('billing_transactions').insert({
          user_id: user.id,
          stripe_invoice_id: `in_should_not_work_${Date.now()}`,
          amount: 1,
          currency: 'BRL',
          status: 'paid',
        })
        expect(error).not.toBeNull()
      } finally {
        await deleteDisposableUser(admin, user.id)
      }
    })
  })
})
