/**
 * tests/integration/collection-item-limit.test.ts
 * Etapa "5.9 — Paywall Técnico (limite de 50 collection_items)" — prova,
 * contra Supabase DEV real (e Stripe TEST real para os cenários de
 * assinatura), que o enforcement de `collection_item_insert_allowed()` +
 * trigger `enforce_restore_limit` + RLS de `collection_items_insert_own`
 * funciona corretamente sob concorrência real, preserva grandfathering, e
 * nunca depende de contagem vinda do cliente.
 *
 * Todo INSERT/UPDATE decisivo (o que está sendo testado) passa pelo client
 * AUTENTICADO real (signInWithPassword + anon key), nunca por
 * `service_role` — exatamente o caminho que o navegador/PostgREST usa.
 * `service_role` é usado só para SETUP (popular itens rapidamente) e
 * CLEANUP, mesmo padrão de todo o resto da suíte.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
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

const RLS_VIOLATION = '42501'

describe.skipIf(!hasTestEnv())('collection_items — limite de 50 (Etapa 5.9, DEV real + Stripe TEST real)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  let proMonthBrlPriceId: string
  const createdStripeCustomerIds = new Set<string>()

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
  }, 60_000)

  async function seedActiveItems(userId: string, n: number): Promise<void> {
    if (n <= 0) return
    const rows = Array.from({ length: n }, (_, i) => ({ user_id: userId, country_code: 'BR', year: 2000 + (i % 20), denomination: `5.9B seed ${i}` }))
    const { error } = await admin.from('collection_items').insert(rows)
    if (error) throw new Error(`seedActiveItems(${n}) falhou: ${error.message}`)
  }

  async function seedTrashedItem(userId: string): Promise<string> {
    const { data, error } = await admin
      .from('collection_items')
      .insert({ user_id: userId, country_code: 'BR', year: 1999, denomination: '5.9B trashed seed', deleted_at: new Date().toISOString() })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedTrashedItem falhou: ${error?.message}`)
    return data.id as string
  }

  async function activeCount(userId: string): Promise<number> {
    const { count, error } = await admin.from('collection_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null)
    if (error) throw new Error(`activeCount falhou: ${error.message}`)
    return count ?? 0
  }

  async function insertOne(client: SupabaseClient, userId: string, label: string) {
    return client.from('collection_items').insert({ user_id: userId, country_code: 'BR', year: 2022, denomination: label }).select('id').single()
  }

  async function setupUserWithRealProSubscription(label: string) {
    const user = await createDisposableUser(admin, label)
    const billingCustomer = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
    createdStripeCustomerIds.add(billingCustomer.stripeCustomerId)

    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: billingCustomer.stripeCustomerId })
    await stripe.customers.update(billingCustomer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } })
    const subscription = await stripe.subscriptions.create({ customer: billingCustomer.stripeCustomerId, items: [{ price: proMonthBrlPriceId }] })
    await syncSubscriptionFromStripe(admin, stripe, subscription.id, 'evt_test_5_9b')

    const client = await signInAsDisposableUser(env, user)
    return { user, client, subscription }
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('collection_items').delete().eq('user_id', user.id)
    await admin.from('benefit_grants').delete().eq('user_id', user.id)
    await admin.from('subscriptions').delete().eq('user_id', user.id)
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  describe('A) 49 ativos + 2 INSERT simultâneos', () => {
    it('exatamente 1 sucesso, 1 bloqueio, total final = 50', async () => {
      const user = await createDisposableUser(admin, 'limit-race-insert')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 49)

        const [r1, r2] = await Promise.allSettled([insertOne(client, user.id, 'race A #1'), insertOne(client, user.id, 'race A #2')])

        const outcomes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason }))
        const successes = outcomes.filter((o) => !o.error)
        const failures = outcomes.filter((o) => o.error)

        expect(successes).toHaveLength(1)
        expect(failures).toHaveLength(1)
        expect((failures[0].error as { code?: string })?.code ?? (failures[0] as { error?: { code?: string } }).error?.code).toBeDefined()

        const final = await activeCount(user.id)
        expect(final).toBe(50)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('B) 50 ativos + INSERT concorrente com soft delete', () => {
    it('total final nunca ultrapassa 50, em repetições sucessivas (ordens diferentes)', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const user = await createDisposableUser(admin, `limit-race-delete-${attempt}`)
        const client = await signInAsDisposableUser(env, user)
        try {
          await seedActiveItems(user.id, 50)
          const { data: existing } = await admin.from('collection_items').select('id').eq('user_id', user.id).is('deleted_at', null).limit(1).single()

          const [insertResult, deleteResult] = await Promise.allSettled([
            insertOne(client, user.id, `race B insert ${attempt}`),
            client.from('collection_items').update({ deleted_at: new Date().toISOString() }).eq('id', existing!.id),
          ])

          const insertSucceeded = insertResult.status === 'fulfilled' && !insertResult.value.error
          const deleteSucceeded = deleteResult.status === 'fulfilled' && !deleteResult.value.error

          expect(deleteSucceeded).toBe(true) // soft delete nunca precisa do lock, sempre permitido

          const final = await activeCount(user.id)
          expect(final).toBeLessThanOrEqual(50)
          expect(final).toBe(insertSucceeded ? 50 : 49) // resultado determinístico a partir do que de fato aconteceu
        } finally {
          await teardownUser(user)
        }
      }
    }, 30_000)
  })

  describe('C) 49 ativos + INSERT concorrente com RESTORE', () => {
    it('nunca ultrapassa 50 — no máximo 1 dos 2 é permitido', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const user = await createDisposableUser(admin, `limit-race-c-${attempt}`)
        const client = await signInAsDisposableUser(env, user)
        try {
          await seedActiveItems(user.id, 49)
          const trashedId = await seedTrashedItem(user.id)

          const [insertResult, restoreResult] = await Promise.allSettled([
            insertOne(client, user.id, `race C insert ${attempt}`),
            client.from('collection_items').update({ deleted_at: null }).eq('id', trashedId),
          ])

          const insertSucceeded = insertResult.status === 'fulfilled' && !insertResult.value.error
          const restoreSucceeded = restoreResult.status === 'fulfilled' && !restoreResult.value.error

          const successCount = Number(insertSucceeded) + Number(restoreSucceeded)
          expect(successCount).toBe(1) // 49→50 tem espaço para exatamente 1 dos 2

          const final = await activeCount(user.id)
          expect(final).toBe(50)
        } finally {
          await teardownUser(user)
        }
      }
    }, 30_000)
  })

  describe('D) 50 ativos + INSERT concorrente com RESTORE', () => {
    it('nunca ultrapassa 50 — nenhum dos 2 é permitido', async () => {
      const user = await createDisposableUser(admin, 'limit-race-d')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 50)
        const trashedId = await seedTrashedItem(user.id)

        const [insertResult, restoreResult] = await Promise.allSettled([insertOne(client, user.id, 'race D insert'), client.from('collection_items').update({ deleted_at: null }).eq('id', trashedId)])

        const insertSucceeded = insertResult.status === 'fulfilled' && !insertResult.value.error
        const restoreSucceeded = restoreResult.status === 'fulfilled' && !restoreResult.value.error

        expect(insertSucceeded).toBe(false)
        expect(restoreSucceeded).toBe(false)

        const final = await activeCount(user.id)
        expect(final).toBe(50)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('E) 50 ativos + 2 RESTOREs simultâneos', () => {
    it('nenhum overshoot — nenhuma das 2 restaurações é permitida', async () => {
      const user = await createDisposableUser(admin, 'limit-race-e')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 50)
        const trashedId1 = await seedTrashedItem(user.id)
        const trashedId2 = await seedTrashedItem(user.id)

        const [r1, r2] = await Promise.allSettled([
          client.from('collection_items').update({ deleted_at: null }).eq('id', trashedId1),
          client.from('collection_items').update({ deleted_at: null }).eq('id', trashedId2),
        ])

        const succeeded1 = r1.status === 'fulfilled' && !r1.value.error
        const succeeded2 = r2.status === 'fulfilled' && !r2.value.error

        expect(Number(succeeded1) + Number(succeeded2)).toBe(0)

        const final = await activeCount(user.id)
        expect(final).toBe(50)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('F) 75 ativos — edição normal', () => {
    it('editar um item ativo é permitido, mesmo acima do limite (grandfathering)', async () => {
      const user = await createDisposableUser(admin, 'limit-grandfather-edit')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 75)
        const { data: existing } = await admin.from('collection_items').select('id').eq('user_id', user.id).is('deleted_at', null).limit(1).single()

        const { error } = await client.from('collection_items').update({ denomination: '5.9B editado' }).eq('id', existing!.id)
        expect(error).toBeNull()

        const final = await activeCount(user.id)
        expect(final).toBe(75) // edição nunca muda a contagem
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('G) 75 ativos — soft delete normal', () => {
    it('excluir (soft delete) um item ativo é permitido, mesmo acima do limite', async () => {
      const user = await createDisposableUser(admin, 'limit-grandfather-delete')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 75)
        const { data: existing } = await admin.from('collection_items').select('id').eq('user_id', user.id).is('deleted_at', null).limit(1).single()

        const { error } = await client.from('collection_items').update({ deleted_at: new Date().toISOString() }).eq('id', existing!.id)
        expect(error).toBeNull()

        const final = await activeCount(user.id)
        expect(final).toBe(74)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('H) 50 ativos + item na lixeira', () => {
    it('RESTORE bloqueado', async () => {
      const user = await createDisposableUser(admin, 'limit-restore-blocked')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 50)
        const trashedId = await seedTrashedItem(user.id)

        const { error } = await client.from('collection_items').update({ deleted_at: null }).eq('id', trashedId)
        expect(error).not.toBeNull()
        expect(error?.code).toBe(RLS_VIOLATION)

        const final = await activeCount(user.id)
        expect(final).toBe(50)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('I) 49 ativos + item na lixeira', () => {
    it('RESTORE permitido, total vira 50', async () => {
      const user = await createDisposableUser(admin, 'limit-restore-allowed')
      const client = await signInAsDisposableUser(env, user)
      try {
        await seedActiveItems(user.id, 49)
        const trashedId = await seedTrashedItem(user.id)

        const { error } = await client.from('collection_items').update({ deleted_at: null }).eq('id', trashedId)
        expect(error).toBeNull()

        const final = await activeCount(user.id)
        expect(final).toBe(50)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('J/L/M) Ciclo de vida de assinatura real (Pro → cancel_at_period_end → cancelada/Free)', () => {
    it('J: Pro ativo — criação ilimitada mesmo muito acima de 50', async () => {
      const { user, client, subscription } = await setupUserWithRealProSubscription('limit-pro-unlimited')
      try {
        await seedActiveItems(user.id, 60)
        const { error } = await insertOne(client, user.id, 'Pro item #61')
        expect(error).toBeNull()

        const final = await activeCount(user.id)
        expect(final).toBe(61)
        void subscription
      } finally {
        await teardownUser(user)
      }
    })

    it('L: cancel_at_period_end=true — continua ilimitado enquanto a assinatura permanecer active', async () => {
      const { user, client, subscription } = await setupUserWithRealProSubscription('limit-pro-cape')
      try {
        await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, null)

        const { data: subRow } = await admin.from('subscriptions').select('status, cancel_at_period_end').eq('stripe_subscription_id', subscription.id).single()
        expect(subRow?.status).toBe('active')
        expect(subRow?.cancel_at_period_end).toBe(true)

        await seedActiveItems(user.id, 60)
        const { error } = await insertOne(client, user.id, 'Pro item apos cancel_at_period_end #61')
        expect(error).toBeNull()
      } finally {
        await teardownUser(user)
      }
    })

    it('M: assinatura efetivamente cancelada — limite de 50 volta a valer só para NOVAS criações/restores; itens existentes permanecem intactos', async () => {
      const { user, client, subscription } = await setupUserWithRealProSubscription('limit-pro-then-free')
      try {
        await seedActiveItems(user.id, 60) // ainda Pro neste momento — 60 é permitido

        await stripe.subscriptions.cancel(subscription.id)
        await syncSubscriptionFromStripe(admin, stripe, subscription.id, null)

        const { data: effective } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
        expect(effective?.[0]?.plan_slug).toBe('free')

        // Itens existentes (60, acima do novo limite Free) permanecem intactos e editáveis.
        const beforeCount = await activeCount(user.id)
        expect(beforeCount).toBe(60)
        const { data: existing } = await admin.from('collection_items').select('id').eq('user_id', user.id).is('deleted_at', null).limit(1).single()
        const { error: editError } = await client.from('collection_items').update({ denomination: '5.9B pós-cancelamento' }).eq('id', existing!.id)
        expect(editError).toBeNull()

        // Nova criação agora É bloqueada (60 >= 50).
        const { error: insertError } = await insertOne(client, user.id, 'Free pós-cancelamento — deveria falhar')
        expect(insertError).not.toBeNull()
        expect(insertError?.code).toBe(RLS_VIOLATION)

        const afterCount = await activeCount(user.id)
        expect(afterCount).toBe(60) // nada mudou pela tentativa bloqueada
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('K) Courtesy Pro ativa', () => {
    it('criação ilimitada via benefit_grants, sem nenhuma subscription/Stripe envolvido', async () => {
      const user = await createDisposableUser(admin, 'limit-courtesy-pro')
      const client = await signInAsDisposableUser(env, user)
      try {
        const { error: grantError } = await admin.from('benefit_grants').insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste 5.9B', created_by: user.id })
        if (grantError) throw new Error(`courtesy grant falhou: ${grantError.message}`)

        await seedActiveItems(user.id, 60)
        const { error } = await insertOne(client, user.id, 'Courtesy Pro item #61')
        expect(error).toBeNull()
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('Regressões — ownership e purchase_id continuam protegidos; trigger não interfere em UPDATE normal', () => {
    it('usuário A não consegue inserir collection_item com user_id de B (ownership RLS pré-existente, inalterada)', async () => {
      const userA = await createDisposableUser(admin, 'limit-ownership-a')
      const userB = await createDisposableUser(admin, 'limit-ownership-b')
      const clientA = await signInAsDisposableUser(env, userA)
      try {
        const { error } = await clientA.from('collection_items').insert({ user_id: userB.id, country_code: 'BR', year: 2020, denomination: 'tentativa cross-user' })
        expect(error).not.toBeNull()
        expect(error?.code).toBe(RLS_VIOLATION)

        const bCount = await activeCount(userB.id)
        expect(bCount).toBe(0)
      } finally {
        await teardownUser(userA)
        await teardownUser(userB)
      }
    })

    it('purchase_id de outro usuário continua rejeitado (validação pré-existente, inalterada)', async () => {
      const userA = await createDisposableUser(admin, 'limit-purchase-a')
      const userB = await createDisposableUser(admin, 'limit-purchase-b')
      const clientA = await signInAsDisposableUser(env, userA)
      const clientB = await signInAsDisposableUser(env, userB)
      try {
        const { data: purchaseB, error: purchaseError } = await clientB.from('purchases').insert({ user_id: userB.id, total_price: 10 }).select('id').single()
        if (purchaseError || !purchaseB) throw new Error(`setup de purchase falhou: ${purchaseError?.message}`)

        const { error } = await clientA.from('collection_items').insert({ user_id: userA.id, purchase_id: purchaseB.id, country_code: 'BR', year: 2020, denomination: 'tentativa purchase alheia' })
        expect(error).not.toBeNull()
        expect(error?.code).toBe(RLS_VIOLATION)
      } finally {
        await teardownUser(userA)
        await teardownUser(userB)
      }
    })
  })
})
