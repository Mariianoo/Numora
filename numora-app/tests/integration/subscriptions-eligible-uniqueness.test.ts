/**
 * tests/integration/subscriptions-eligible-uniqueness.test.ts
 * Etapa "Stripe 5.1 — Subscription schema hardening" — prova, contra
 * Supabase DEV real, que a migration
 * `20260905150000_subscriptions_one_eligible_per_user.sql` implementa
 * exatamente a proteção aprovada: um mesmo usuário nunca pode ter mais de
 * uma subscription simultaneamente em um status que `effective_plans()`
 * trata como "concede acesso" (`trialing`, `active`, `past_due`) — via
 * índice único parcial `uq_subscriptions_user_id_active_status`.
 *
 * Todos os estados NÃO elegíveis (`canceled`, `incomplete`,
 * `incomplete_expired`, `unpaid`, `paused`) são testados explicitamente
 * coexistindo com uma subscription elegível — por design essa coexistência
 * é sempre permitida: o índice usa exatamente o mesmo conjunto de
 * `effective_plans()`, nenhuma política nova foi inventada para esta etapa.
 *
 * `stripe_price_id` é sempre `null` em todas as subscriptions criadas aqui
 * — a coerência price↔plan já está coberta por
 * `plan-prices-subscription-integrity.test.ts`; usar `null` evita qualquer
 * dependência do catálogo comercial real ou de Prices sintéticos.
 *
 * Cada preocupação usa seu(s) PRÓPRIO(S) usuário(s)/billing_customer(s)
 * descartável(is), limpos em `finally`/`afterAll` — nunca compartilhados
 * entre concerns, para nenhum teste depender de ordem de execução.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, type DisposableUser, type TestEnv } from '../support/dev-env'

const NON_ELIGIBLE_STATUSES = ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'] as const

describe.skipIf(!hasTestEnv())('subscriptions — unicidade de estado elegível por usuário (Stripe 5.1)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let testPlanId: string

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    const { data: plan, error } = await admin
      .from('plans')
      .insert({ name: 'Teste Stripe 5.1', slug: `test-stripe51-${Date.now().toString().slice(-8)}`, active: false })
      .select('id')
      .single()
    if (error || !plan) throw new Error(`[subscriptions-eligible-uniqueness.test] setup do plano falhou: ${error?.message}`)
    testPlanId = plan.id as string
  })

  afterAll(async () => {
    await admin.from('plans').delete().eq('id', testPlanId)
  })

  async function setupUserWithCustomer(label: string): Promise<{ user: DisposableUser; billingCustomerId: string }> {
    const user = await createDisposableUser(admin, label)
    const { data: customer, error } = await admin
      .from('billing_customers')
      .insert({ user_id: user.id, stripe_customer_id: `cus_test51_${label}_${Date.now()}` })
      .select('id')
      .single()
    if (error || !customer) throw new Error(`[subscriptions-eligible-uniqueness.test] setup de billing_customers falhou (${label}): ${error?.message}`)
    return { user, billingCustomerId: customer.id as string }
  }

  async function teardownUser(user: DisposableUser, billingCustomerId: string): Promise<void> {
    await admin.from('subscriptions').delete().eq('billing_customer_id', billingCustomerId)
    await admin.from('billing_customers').delete().eq('id', billingCustomerId)
    await deleteDisposableUser(admin, user.id)
  }

  function insertSub(userId: string, billingCustomerId: string, status: string, suffix: string) {
    return admin
      .from('subscriptions')
      .insert({
        user_id: userId,
        billing_customer_id: billingCustomerId,
        stripe_subscription_id: `sub_test51_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        stripe_price_id: null,
        plan_id: testPlanId,
        status,
      })
      .select('id')
      .single()
  }

  describe('FASE 3 — combinações de 2 estados ELEGÍVEIS simultâneos são sempre rejeitadas', () => {
    const combos: Array<[string, string]> = [
      ['active', 'active'],
      ['active', 'trialing'],
      ['active', 'past_due'],
      ['trialing', 'trialing'],
      ['trialing', 'past_due'],
      ['past_due', 'past_due'],
    ]

    for (const [firstStatus, secondStatus] of combos) {
      it(`${firstStatus} + ${secondStatus} — segunda subscription elegível é rejeitada (23505)`, async () => {
        const { user, billingCustomerId } = await setupUserWithCustomer(`combo-${firstStatus}-${secondStatus}`)
        try {
          const { data: first, error: firstError } = await insertSub(user.id, billingCustomerId, firstStatus, 'first')
          expect(firstError).toBeNull()
          expect(first).not.toBeNull()

          const { error: secondError } = await insertSub(user.id, billingCustomerId, secondStatus, 'second')
          expect(secondError).not.toBeNull()
          expect(secondError?.code).toBe('23505')

          const { data: remaining } = await admin.from('subscriptions').select('id').eq('billing_customer_id', billingCustomerId)
          expect(remaining).toHaveLength(1) // segundo insert rejeitado — nada além da primeira persistiu
        } finally {
          await teardownUser(user, billingCustomerId)
        }
      })
    }
  })

  describe('FASE 3 — estado elegível + cada estado NÃO elegível: coexistência é permitida (comportamento aprovado)', () => {
    for (const nonEligibleStatus of NON_ELIGIBLE_STATUSES) {
      it(`active + ${nonEligibleStatus} — ambas coexistem (${nonEligibleStatus} nunca ocupa a vaga, mesmo conjunto de effective_plans())`, async () => {
        const { user, billingCustomerId } = await setupUserWithCustomer(`noneligible-${nonEligibleStatus}`)
        try {
          const { error: activeError } = await insertSub(user.id, billingCustomerId, 'active', 'eligible')
          expect(activeError).toBeNull()

          const { error: otherError } = await insertSub(user.id, billingCustomerId, nonEligibleStatus, 'noneligible')
          expect(otherError).toBeNull()

          const { data: rows } = await admin.from('subscriptions').select('status').eq('billing_customer_id', billingCustomerId)
          expect((rows ?? []).map((r) => r.status).sort()).toEqual(['active', nonEligibleStatus].sort())
        } finally {
          await teardownUser(user, billingCustomerId)
        }
      })
    }
  })

  describe('FASE 4 — integridade: independência entre usuários e transições via UPDATE', () => {
    it('usuário A com subscription active não interfere em usuário B (índice é por user_id)', async () => {
      const a = await setupUserWithCustomer('userA-independence')
      const b = await setupUserWithCustomer('userB-independence')
      try {
        const { error: aError } = await insertSub(a.user.id, a.billingCustomerId, 'active', 'a')
        expect(aError).toBeNull()

        const { error: bError } = await insertSub(b.user.id, b.billingCustomerId, 'active', 'b')
        expect(bError).toBeNull()
      } finally {
        await teardownUser(a.user, a.billingCustomerId)
        await teardownUser(b.user, b.billingCustomerId)
      }
    })

    it('a mesma subscription pode continuar sendo atualizada em campos não relacionados a status', async () => {
      const { user, billingCustomerId } = await setupUserWithCustomer('same-sub-update')
      try {
        const { data, error } = await insertSub(user.id, billingCustomerId, 'active', 'stable')
        expect(error).toBeNull()

        const newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const { error: updateError } = await admin.from('subscriptions').update({ current_period_end: newPeriodEnd }).eq('id', data!.id)
        expect(updateError).toBeNull()

        const { data: after } = await admin.from('subscriptions').select('current_period_end, status').eq('id', data!.id).single()
        expect(after?.status).toBe('active')
        // Postgres devolve timestamptz como "+00:00", não "Z" — compara os instantes, não a string.
        expect(new Date(after!.current_period_end as string).getTime()).toBe(new Date(newPeriodEnd).getTime())
      } finally {
        await teardownUser(user, billingCustomerId)
      }
    })

    it('active → canceled libera a vaga; uma nova active pode então ser criada', async () => {
      const { user, billingCustomerId } = await setupUserWithCustomer('active-to-canceled')
      try {
        const { data: sub1, error: sub1Error } = await insertSub(user.id, billingCustomerId, 'active', 'v1')
        expect(sub1Error).toBeNull()

        const { error: cancelError } = await admin.from('subscriptions').update({ status: 'canceled' }).eq('id', sub1!.id)
        expect(cancelError).toBeNull()

        const { error: newActiveError } = await insertSub(user.id, billingCustomerId, 'active', 'v2')
        expect(newActiveError).toBeNull()
      } finally {
        await teardownUser(user, billingCustomerId)
      }
    })

    it('active → past_due continua ocupando a vaga; past_due → canceled libera de novo', async () => {
      const { user, billingCustomerId } = await setupUserWithCustomer('active-to-pastdue')
      try {
        const { data: sub1, error: sub1Error } = await insertSub(user.id, billingCustomerId, 'active', 'v1')
        expect(sub1Error).toBeNull()

        const { error: pastDueError } = await admin.from('subscriptions').update({ status: 'past_due' }).eq('id', sub1!.id)
        expect(pastDueError).toBeNull()

        const { error: secondActiveError } = await insertSub(user.id, billingCustomerId, 'active', 'v2')
        expect(secondActiveError).not.toBeNull()
        expect(secondActiveError?.code).toBe('23505')

        const { error: cancelError } = await admin.from('subscriptions').update({ status: 'canceled' }).eq('id', sub1!.id)
        expect(cancelError).toBeNull()

        const { error: thirdActiveError } = await insertSub(user.id, billingCustomerId, 'active', 'v3')
        expect(thirdActiveError).toBeNull()
      } finally {
        await teardownUser(user, billingCustomerId)
      }
    })

    it('a proteção também vale para UPDATE (não só INSERT): promover uma subscription não elegível para active é rejeitado', async () => {
      const { user, billingCustomerId } = await setupUserWithCustomer('update-enforcement')
      try {
        const { error: activeError } = await insertSub(user.id, billingCustomerId, 'active', 'holder')
        expect(activeError).toBeNull()

        const { data: canceledSub, error: canceledError } = await insertSub(user.id, billingCustomerId, 'canceled', 'other')
        expect(canceledError).toBeNull()

        const { error: promoteError } = await admin.from('subscriptions').update({ status: 'active' }).eq('id', canceledSub!.id)
        expect(promoteError).not.toBeNull()
        expect(promoteError?.code).toBe('23505')
      } finally {
        await teardownUser(user, billingCustomerId)
      }
    })
  })
})
