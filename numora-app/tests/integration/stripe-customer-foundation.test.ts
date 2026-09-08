/**
 * tests/integration/stripe-customer-foundation.test.ts
 * Etapa "Stripe 5.2 — Customer Foundation" — prova, contra Supabase DEV
 * real E Stripe TEST MODE real, que `getOrCreateBillingCustomer`
 * (lib/stripe/customer.ts) cria/reaproveita corretamente, respeita
 * concorrência e não enfraquece RLS.
 *
 * ÚNICO arquivo desta etapa que chama o Stripe de verdade — sempre TEST
 * MODE (`getStripeClient()` já valida `sk_test_` via `assertStripeTestMode`
 * antes de qualquer chamada). Todo Customer criado aqui é registrado e
 * removido no cleanup (`stripe.customers.del`) — NUNCA toca Products/Prices
 * (o catálogo comercial real de 2 Products + 8 Prices nunca é lido nem
 * escrito por este arquivo).
 *
 * Cenários de FALHA determinística (Stripe "falhando sob demanda", erro de
 * INSERT não relacionado a corrida) estão em tests/unit/stripe-customer.test.ts
 * (mockados) — não é seguro/possível forçar esses cenários contra o Stripe
 * real de forma confiável.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { getStripeClient } from '@/lib/stripe/client'
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

describe.skipIf(!hasTestEnv())('getOrCreateBillingCustomer (DEV real + Stripe TEST real) — Stripe 5.2', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let stripe: Stripe
  const createdStripeCustomerIds = new Set<string>()

  beforeAll(() => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    stripe = getStripeClient()
  })

  afterAll(async () => {
    // Limpeza dos Customers de TESTE MODE criados por este arquivo — nunca
    // Products/Prices, nunca um Customer que este arquivo não criou.
    for (const id of createdStripeCustomerIds) {
      try {
        await stripe.customers.del(id)
      } catch {
        // Idempotente o suficiente para este cleanup: se já foi removido
        // (ex.: teste de corrida já o exercitou), seguir em frente.
      }
    }
  })

  async function setupUser(label: string): Promise<DisposableUser> {
    return createDisposableUser(admin, label)
  }

  async function teardownUser(user: DisposableUser): Promise<void> {
    await admin.from('billing_customers').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  }

  describe('FASE 7 — criação e reutilização', () => {
    it('TESTE 1 — usuário sem billing_customer: cria Customer real no Stripe TEST e persiste localmente', async () => {
      const user = await setupUser('customer-create')
      try {
        const result = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
        createdStripeCustomerIds.add(result.stripeCustomerId)

        expect(result.created).toBe(true)
        expect(result.stripeCustomerId).toMatch(/^cus_/)

        const { data: row, error } = await admin.from('billing_customers').select('user_id, stripe_customer_id').eq('id', result.billingCustomerId).single()
        expect(error).toBeNull()
        expect(row?.user_id).toBe(user.id)
        expect(row?.stripe_customer_id).toBe(result.stripeCustomerId)

        // FASE 8H/8I — metadata e email realmente gravados no Stripe.
        const stripeCustomer = await stripe.customers.retrieve(result.stripeCustomerId)
        if (stripeCustomer.deleted) throw new Error('Customer inesperadamente deletado logo após criação')
        expect(stripeCustomer.metadata.numora_user_id).toBe(user.id)
        expect(stripeCustomer.email).toBe(user.email)
      } finally {
        await teardownUser(user)
      }
    })

    it('TESTE 2/3 — chamar de novo para o MESMO usuário reutiliza, nunca cria um segundo Customer', async () => {
      const user = await setupUser('customer-reuse')
      try {
        const first = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
        createdStripeCustomerIds.add(first.stripeCustomerId)

        const second = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })

        expect(second.created).toBe(false)
        expect(second.billingCustomerId).toBe(first.billingCustomerId)
        expect(second.stripeCustomerId).toBe(first.stripeCustomerId)

        // TESTE 4 — billing_customers continua com uma única linha para este usuário.
        const { data: rows } = await admin.from('billing_customers').select('id').eq('user_id', user.id)
        expect(rows).toHaveLength(1)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 6 — concorrência: 2 requisições simultâneas para o mesmo usuário', () => {
    it('resultam em exatamente 1 billing_customer local e 1 Stripe Customer', async () => {
      const user = await setupUser('customer-race')
      try {
        const [resultA, resultB] = await Promise.all([
          getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email }),
          getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email }),
        ])
        createdStripeCustomerIds.add(resultA.stripeCustomerId)
        createdStripeCustomerIds.add(resultB.stripeCustomerId)

        expect(resultA.stripeCustomerId).toBe(resultB.stripeCustomerId) // mesma Idempotency-Key ⇒ mesmo Customer no Stripe
        expect(resultA.billingCustomerId).toBe(resultB.billingCustomerId)

        // Exatamente uma das duas efetivamente criou — a outra reutilizou (perdeu a corrida do INSERT).
        const createdFlags = [resultA.created, resultB.created].sort()
        expect(createdFlags).toEqual([false, true])

        const { data: rows } = await admin.from('billing_customers').select('id').eq('user_id', user.id)
        expect(rows).toHaveLength(1)
      } finally {
        await teardownUser(user)
      }
    })
  })

  describe('FASE 8 — integridade entre usuários', () => {
    it('usuário A e usuário B têm Customers distintos; A nunca recebe o Customer de B', async () => {
      const userA = await setupUser('customer-isolation-a')
      const userB = await setupUser('customer-isolation-b')
      try {
        const resultA = await getOrCreateBillingCustomer(admin, stripe, { userId: userA.id, email: userA.email })
        const resultB = await getOrCreateBillingCustomer(admin, stripe, { userId: userB.id, email: userB.email })
        createdStripeCustomerIds.add(resultA.stripeCustomerId)
        createdStripeCustomerIds.add(resultB.stripeCustomerId)

        expect(resultA.stripeCustomerId).not.toBe(resultB.stripeCustomerId)
        expect(resultA.billingCustomerId).not.toBe(resultB.billingCustomerId)

        const { data: rowA } = await admin.from('billing_customers').select('user_id').eq('id', resultA.billingCustomerId).single()
        expect(rowA?.user_id).toBe(userA.id)
      } finally {
        await teardownUser(userA)
        await teardownUser(userB)
      }
    })
  })

  describe('FASE 11 — constraints locais (unicidade), independente da função', () => {
    it('D/F — unicidade de user_id: um segundo billing_customer para o mesmo usuário é rejeitado (23505)', async () => {
      const user = await setupUser('customer-unique-user')
      try {
        const { data: first, error: firstError } = await admin
          .from('billing_customers')
          .insert({ user_id: user.id, stripe_customer_id: `cus_test52_dup_a_${Date.now()}` })
          .select('id')
          .single()
        expect(firstError).toBeNull()

        const { error: secondError } = await admin.from('billing_customers').insert({ user_id: user.id, stripe_customer_id: `cus_test52_dup_b_${Date.now()}` })
        expect(secondError).not.toBeNull()
        expect(secondError?.code).toBe('23505')

        await admin.from('billing_customers').delete().eq('id', first!.id)
      } finally {
        await teardownUser(user)
      }
    })

    it('G — unicidade de stripe_customer_id: dois usuários não podem apontar para o mesmo Stripe Customer (23505)', async () => {
      const userA = await setupUser('customer-unique-stripe-a')
      const userB = await setupUser('customer-unique-stripe-b')
      const sharedStripeCustomerId = `cus_test52_shared_${Date.now()}`
      try {
        const { error: firstError } = await admin.from('billing_customers').insert({ user_id: userA.id, stripe_customer_id: sharedStripeCustomerId })
        expect(firstError).toBeNull()

        const { error: secondError } = await admin.from('billing_customers').insert({ user_id: userB.id, stripe_customer_id: sharedStripeCustomerId })
        expect(secondError).not.toBeNull()
        expect(secondError?.code).toBe('23505')
      } finally {
        await teardownUser(userA)
        await teardownUser(userB)
      }
    })

    it('E — billing_customers.user_id NOT NULL: insert sem user_id é rejeitado', async () => {
      const { error } = await admin.from('billing_customers').insert({ stripe_customer_id: `cus_test52_nouser_${Date.now()}` })
      expect(error).not.toBeNull()
    })
  })

  describe('FASE 12 — RLS não foi enfraquecido', () => {
    it('usuário comum não vê nem escreve em billing_customers (nem a própria linha)', async () => {
      const user = await setupUser('customer-rls')
      try {
        const result = await getOrCreateBillingCustomer(admin, stripe, { userId: user.id, email: user.email })
        createdStripeCustomerIds.add(result.stripeCustomerId)

        const userClient = await signInAsDisposableUser(env, user)

        const { data: selectData, error: selectError } = await userClient.from('billing_customers').select('id').eq('user_id', user.id)
        expect(selectError).toBeNull()
        expect(selectData).toEqual([]) // RLS filtra silenciosamente — nenhuma policy de SELECT libera o próprio usuário

        const { error: insertError } = await userClient
          .from('billing_customers')
          .insert({ user_id: user.id, stripe_customer_id: `cus_test52_rls_${Date.now()}` })
        expect(insertError).not.toBeNull() // só is_platform_owner() pode inserir

        const { error: updateError } = await userClient
          .from('billing_customers')
          .update({ stripe_customer_id: `cus_test52_rls_update_${Date.now()}` })
          .eq('id', result.billingCustomerId)
        expect(updateError).toBeNull() // RLS nunca retorna erro para UPDATE sem match — só afeta 0 linhas
        const { data: unchanged } = await admin.from('billing_customers').select('stripe_customer_id').eq('id', result.billingCustomerId).single()
        expect(unchanged?.stripe_customer_id).toBe(result.stripeCustomerId) // confirma que nada foi alterado

        const { error: deleteError } = await userClient.from('billing_customers').delete().eq('id', result.billingCustomerId)
        expect(deleteError).toBeNull() // mesmo raciocínio: sem erro, mas 0 linhas afetadas
        const { data: stillThere } = await admin.from('billing_customers').select('id').eq('id', result.billingCustomerId).single()
        expect(stillThere?.id).toBe(result.billingCustomerId) // confirma que a linha sobreviveu
      } finally {
        await teardownUser(user)
      }
    })
  })
})
