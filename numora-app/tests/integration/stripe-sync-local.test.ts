/**
 * tests/integration/stripe-sync-local.test.ts
 * Etapa "Stripe 4.1.1 — Teste real da sincronização local no DEV" — prova,
 * contra Supabase DEV real, que `recordStripePriceSync()`/
 * `activateSyncedPrice()` (lib/stripe/sync.ts, Stripe 4.1A, até aqui só
 * cobertas por mock) funcionam corretamente contra o banco de verdade,
 * respeitando todas as proteções já implementadas (Stripe 3.2/3.4):
 * índice único parcial, CHECK active→stripe_price_id, trigger de
 * imutabilidade, effective period, RLS, coerência subscription↔price.
 *
 * ZERO chamada ao Stripe — `stripe_price_id` é sempre um valor sintético
 * (`price_test_numora_sync_<uuid>`), nunca um ID real. Usa o `plan_id`
 * REAL de `pro` (pedido explícito da etapa: "use plano Pro existente"),
 * mas as LINHAS de `plan_prices` são sempre temporárias/descartáveis
 * (amount claramente fictício, nunca reaproveitando nenhuma das 8 linhas
 * comerciais reais) — limpas no `afterAll`, nunca deixadas para trás.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { activateSyncedPrice, recordStripePriceSync } from '@/lib/stripe/sync'
import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'

const TEST_AMOUNT_1 = 1.23 // claramente fictício — nunca um valor comercial real
const TEST_AMOUNT_2 = 4.56
const EFFECTIVE_FROM_PAST = '2020-01-01T00:00:00Z'

describe.skipIf(!hasTestEnv())('Stripe 4.1.1 — sincronização local real (recordStripePriceSync / activateSyncedPrice)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let proPlanId: string
  let temp1Id: string
  const temp1StripePriceId = `price_test_numora_sync_${crypto.randomUUID()}`

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    const { data: plan, error: planError } = await admin.from('plans').select('id').eq('slug', 'pro').single()
    if (planError || !plan) throw new Error(`[stripe-sync-local.test] falha ao ler o plano Pro real: ${planError?.message}`)
    proPlanId = plan.id as string

    const { data: temp1, error: temp1Error } = await admin
      .from('plan_prices')
      .insert({
        plan_id: proPlanId,
        interval: 'month',
        currency: 'BRL',
        amount: TEST_AMOUNT_1,
        active: false,
        stripe_price_id: null,
        effective_from: EFFECTIVE_FROM_PAST,
        effective_until: null,
      })
      .select('id')
      .single()
    if (temp1Error || !temp1) throw new Error(`[stripe-sync-local.test] setup do plan_price temporário falhou: ${temp1Error?.message}`)
    temp1Id = temp1.id as string
  })

  afterAll(async () => {
    // Ordem: qualquer subscription temporária (nenhuma deveria sobrar — os
    // inserts de teste que a criam são sempre rejeitados pelo trigger),
    // depois os plan_prices temporários. Nunca toca nas 8 linhas reais.
    await admin.from('plan_prices').delete().eq('plan_id', proPlanId).in('amount', [TEST_AMOUNT_1, TEST_AMOUNT_2])
  })

  it('PRÉ-CHECAGEM — plan_price temporário criado corretamente, isolado das 8 linhas reais', async () => {
    const { data, error } = await admin.from('plan_prices').select('*').eq('id', temp1Id).single()
    expect(error).toBeNull()
    expect(data?.plan_id).toBe(proPlanId)
    expect(Number(data?.amount)).toBe(TEST_AMOUNT_1)
    expect(data?.active).toBe(false)
    expect(data?.stripe_price_id).toBeNull()
  })

  it('TESTE 3 — recordStripePriceSync() grava stripe_price_id sem alterar mais nada', async () => {
    await recordStripePriceSync(admin, temp1Id, temp1StripePriceId)

    const { data, error } = await admin.from('plan_prices').select('*').eq('id', temp1Id).single()
    expect(error).toBeNull()
    expect(data?.stripe_price_id).toBe(temp1StripePriceId)
    expect(data?.active).toBe(false) // permanece false — recordStripePriceSync nunca ativa
    expect(Number(data?.amount)).toBe(TEST_AMOUNT_1)
    expect(data?.currency).toBe('BRL')
    expect(data?.interval).toBe('month')
    expect(data?.plan_id).toBe(proPlanId)
    expect(data?.effective_from).toBe('2020-01-01T00:00:00+00:00')
    expect(data?.effective_until).toBeNull()
  })

  it('TESTE 4 — activateSyncedPrice() ativa sem alterar nenhum campo comercial', async () => {
    await activateSyncedPrice(admin, temp1Id)

    const { data, error } = await admin.from('plan_prices').select('*').eq('id', temp1Id).single()
    expect(error).toBeNull()
    expect(data?.stripe_price_id).toBe(temp1StripePriceId) // continua o mesmo
    expect(data?.active).toBe(true)
    expect(Number(data?.amount)).toBe(TEST_AMOUNT_1)
    expect(data?.currency).toBe('BRL')
    expect(data?.interval).toBe('month')
    expect(data?.plan_id).toBe(proPlanId)
  })

  it('TESTE 5 — ordem incorreta: activateSyncedPrice() numa linha sem stripe_price_id continua rejeitado pelo banco', async () => {
    const { data: temp2, error: temp2Error } = await admin
      .from('plan_prices')
      .insert({
        plan_id: proPlanId,
        interval: 'year', // combinação diferente de temp1, só para não interferir neste teste isolado
        currency: 'BRL',
        amount: TEST_AMOUNT_2,
        active: false,
        stripe_price_id: null,
        effective_from: EFFECTIVE_FROM_PAST,
      })
      .select('id')
      .single()
    if (temp2Error || !temp2) throw new Error(`setup falhou: ${temp2Error?.message}`)

    await expect(activateSyncedPrice(admin, temp2.id as string)).rejects.toThrow()

    const { data: check } = await admin.from('plan_prices').select('active, stripe_price_id').eq('id', temp2.id).single()
    expect(check?.active).toBe(false) // rejeitado — estado original preservado
    expect(check?.stripe_price_id).toBeNull()

    await admin.from('plan_prices').delete().eq('id', temp2.id)
  })

  describe('TESTE 6 — imutabilidade (linha já sincronizada e ativa)', () => {
    it('amount/currency/interval/plan_id/stripe_price_id são rejeitados', async () => {
      const { error: amountError } = await admin.from('plan_prices').update({ amount: 99.99 }).eq('id', temp1Id)
      expect(amountError).not.toBeNull()
      expect(amountError?.code).toBe('23514')

      const { error: currencyError } = await admin.from('plan_prices').update({ currency: 'USD' }).eq('id', temp1Id)
      expect(currencyError).not.toBeNull()
      expect(currencyError?.code).toBe('23514')

      const { error: intervalError } = await admin.from('plan_prices').update({ interval: 'year' }).eq('id', temp1Id)
      expect(intervalError).not.toBeNull()
      expect(intervalError?.code).toBe('23514')

      const { data: premium } = await admin.from('plans').select('id').eq('slug', 'premium').single()
      const { error: planIdError } = await admin.from('plan_prices').update({ plan_id: premium!.id }).eq('id', temp1Id)
      expect(planIdError).not.toBeNull()
      expect(planIdError?.code).toBe('23514')

      const { error: stripeIdError } = await admin.from('plan_prices').update({ stripe_price_id: 'price_outro_valor' }).eq('id', temp1Id)
      expect(stripeIdError).not.toBeNull()
      expect(stripeIdError?.code).toBe('23514')
    })

    it('active/effective_from/effective_until continuam livremente editáveis (toggle e reversão, sem efeito líquido)', async () => {
      const { error: deactivateError } = await admin.from('plan_prices').update({ active: false }).eq('id', temp1Id)
      expect(deactivateError).toBeNull()

      const { error: reactivateError } = await admin.from('plan_prices').update({ active: true }).eq('id', temp1Id)
      expect(reactivateError).toBeNull()

      const futureDate = '2099-01-01T00:00:00Z'
      const { error: setUntilError } = await admin.from('plan_prices').update({ effective_until: futureDate }).eq('id', temp1Id)
      expect(setUntilError).toBeNull()

      const { error: clearUntilError } = await admin.from('plan_prices').update({ effective_until: null }).eq('id', temp1Id)
      expect(clearUntilError).toBeNull()

      const { data } = await admin.from('plan_prices').select('active, effective_until').eq('id', temp1Id).single()
      expect(data?.active).toBe(true)
      expect(data?.effective_until).toBeNull()
    })
  })

  it('TESTE 7 — duplicidade: segunda versão da mesma combinação coexiste inativa, mas não pode ativar enquanto a primeira está ativa', async () => {
    const { data: temp3, error: temp3Error } = await admin
      .from('plan_prices')
      .insert({
        plan_id: proPlanId,
        interval: 'month', // mesma combinação de temp1 (que está active=true agora)
        currency: 'BRL',
        amount: TEST_AMOUNT_2,
        active: false,
        stripe_price_id: null,
        effective_from: EFFECTIVE_FROM_PAST,
      })
      .select('id')
      .single()
    expect(temp3Error).toBeNull()
    expect(temp3).not.toBeNull()

    const temp3StripePriceId = `price_test_numora_sync_dup_${crypto.randomUUID()}`
    await recordStripePriceSync(admin, temp3!.id as string, temp3StripePriceId)

    await expect(activateSyncedPrice(admin, temp3!.id as string)).rejects.toThrow()

    const { data: check } = await admin.from('plan_prices').select('active').eq('id', temp3!.id).single()
    expect(check?.active).toBe(false) // rejeitado pelo índice único parcial — temp1 continua sendo a única ativa

    await admin.from('plan_prices').delete().eq('id', temp3!.id)
  })

  describe('TESTE 8 — integridade subscription↔price (dado descartável, nunca persistente)', () => {
    let user: DisposableUser
    let billingCustomerId: string

    beforeAll(async () => {
      user = await createDisposableUser(admin, 'stripe411-sub-integrity')
      const { data: customer, error } = await admin
        .from('billing_customers')
        .insert({ user_id: user.id, stripe_customer_id: `cus_test_411_${Date.now()}` })
        .select('id')
        .single()
      if (error || !customer) throw new Error(`setup de billing_customers falhou: ${error?.message}`)
      billingCustomerId = customer.id as string
    })

    afterAll(async () => {
      await admin.from('billing_customers').delete().eq('id', billingCustomerId)
      await deleteDisposableUser(admin, user.id)
    })

    it('subscription com plan_id diferente do plan_price referenciado é rejeitada', async () => {
      const { data: premium } = await admin.from('plans').select('id').eq('slug', 'premium').single()

      const { error } = await admin.from('subscriptions').insert({
        user_id: user.id,
        billing_customer_id: billingCustomerId,
        stripe_subscription_id: `sub_test_411_${Date.now()}`,
        stripe_price_id: temp1StripePriceId, // pertence a Pro (proPlanId)
        plan_id: premium!.id, // divergente de propósito
        status: 'active',
      })

      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')

      const { data: leftover } = await admin.from('subscriptions').select('id').eq('billing_customer_id', billingCustomerId)
      expect(leftover).toEqual([]) // insert rejeitado — nada persistiu
    })
  })

  it('TESTE 9 — idempotência local: reexecutar recordStripePriceSync() com o mesmo stripe_price_id é seguro', async () => {
    // O trigger de imutabilidade só bloqueia TROCAR para um valor
    // diferente (`is distinct from`) — regravar o MESMO valor já
    // existente não é uma mudança, então não é rejeitado. Nenhuma segunda
    // linha é criada (é sempre um UPDATE por id, nunca um INSERT), nenhum
    // outro campo é tocado pela função.
    await expect(recordStripePriceSync(admin, temp1Id, temp1StripePriceId)).resolves.toBeUndefined()

    const { data, error } = await admin.from('plan_prices').select('*').eq('id', temp1Id).single()
    expect(error).toBeNull()
    expect(data?.stripe_price_id).toBe(temp1StripePriceId)
    expect(Number(data?.amount)).toBe(TEST_AMOUNT_1)
    expect(data?.currency).toBe('BRL')
    expect(data?.interval).toBe('month')
    expect(data?.active).toBe(true)

    const { data: allTemp1Rows } = await admin.from('plan_prices').select('id').eq('stripe_price_id', temp1StripePriceId)
    expect(allTemp1Rows).toHaveLength(1) // nenhuma duplicata criada
  })

  it('CLEANUP — as 8 linhas comerciais reais permanecem intactas (nunca tocadas por este arquivo)', async () => {
    const { data: realRows, error } = await admin
      .from('plan_prices')
      .select('active, stripe_price_id, amount')
      .not('amount', 'in', `(${TEST_AMOUNT_1},${TEST_AMOUNT_2})`)
    expect(error).toBeNull()
    expect(realRows).toHaveLength(8)
    for (const row of realRows ?? []) {
      expect(row.active).toBe(false)
      expect(row.stripe_price_id).toBeNull()
    }
  })
})
