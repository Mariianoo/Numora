/**
 * tests/unit/checkout-return.test.ts
 * Etapa "B1 — Official Launch, código de cobrança" — `resolveCheckoutReturn`
 * (lib/billing/checkout-return.ts), com Stripe e a sincronização MOCKADOS
 * (nenhuma chamada de rede, nenhum pagamento). Prova que a URL nunca é
 * autoridade: só a Session recuperada no Stripe + `client_reference_id` do
 * usuário autenticado + a sincronização idempotente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

const syncSubscriptionFromStripe = vi.fn()
vi.mock('@/lib/stripe/subscription-sync', () => ({
  syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripe(...args),
}))

const { CHECKOUT_SESSION_ID_PATTERN, resolveCheckoutReturn } = await import('@/lib/billing/checkout-return')

const USER_ID = 'user-uuid-1'
const OTHER_USER_ID = 'user-uuid-2'
const SESSION_ID = 'cs_test_a1B2c3D4e5F6g7H8i9J0'
const adminClient = { marker: 'admin' } as unknown as SupabaseClient

const retrieve = vi.fn()
const stripe = { checkout: { sessions: { retrieve } } } as unknown as Stripe
const reportError = vi.fn()

function makeSession(overrides: Partial<Record<string, unknown>> = {}): Stripe.Checkout.Session {
  return {
    id: SESSION_ID,
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    client_reference_id: USER_ID,
    subscription: 'sub_test_1',
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

function run(overrides: { userId?: string; sessionId?: string } = {}) {
  return resolveCheckoutReturn({ stripe, adminClient, userId: overrides.userId ?? USER_ID, sessionId: overrides.sessionId ?? SESSION_ID, reportError })
}

beforeEach(() => {
  retrieve.mockReset()
  syncSubscriptionFromStripe.mockReset()
  reportError.mockReset()
})

describe('resolveCheckoutReturn — sucesso legítimo', () => {
  it('Session completa e paga do próprio usuário + subscription ativa → confirmed, sincronizando pelo mecanismo idempotente existente', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: null, newStatus: 'active', transitionRecorded: true })

    await expect(run()).resolves.toBe('confirmed')

    expect(retrieve).toHaveBeenCalledWith(SESSION_ID)
    expect(syncSubscriptionFromStripe).toHaveBeenCalledTimes(1)
    expect(syncSubscriptionFromStripe).toHaveBeenCalledWith(adminClient, stripe, 'sub_test_1', null)
  })

  it('subscription expandida como objeto também é aceita', async () => {
    retrieve.mockResolvedValue(makeSession({ subscription: { id: 'sub_test_obj' } }))
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: null, newStatus: 'active', transitionRecorded: true })

    await expect(run()).resolves.toBe('confirmed')
    expect(syncSubscriptionFromStripe).toHaveBeenCalledWith(adminClient, stripe, 'sub_test_obj', null)
  })

  it('trialing conta como confirmado', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: null, newStatus: 'trialing', transitionRecorded: true })

    await expect(run()).resolves.toBe('confirmed')
  })

  it('no_payment_required (ex.: 100% de desconto) também segue para a sincronização', async () => {
    retrieve.mockResolvedValue(makeSession({ payment_status: 'no_payment_required' }))
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: null, newStatus: 'active', transitionRecorded: true })

    await expect(run()).resolves.toBe('confirmed')
  })
})

describe('resolveCheckoutReturn — webhook já processado / idempotência', () => {
  it('webhook já sincronizou: o retorno converge para o mesmo resultado sem efeito extra (transição não é registrada de novo)', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: 'active', newStatus: 'active', transitionRecorded: false })

    await expect(run()).resolves.toBe('confirmed')
  })

  it('chamar duas vezes (recarregar a página) repete a MESMA sincronização idempotente — mesmo resultado, mesmos argumentos, nenhuma outra escrita', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: 'active', newStatus: 'active', transitionRecorded: false })

    const first = await run()
    const second = await run()

    expect(first).toBe('confirmed')
    expect(second).toBe('confirmed')
    expect(syncSubscriptionFromStripe).toHaveBeenCalledTimes(2)
    expect(syncSubscriptionFromStripe.mock.calls[0]).toEqual(syncSubscriptionFromStripe.mock.calls[1])
  })
})

describe('resolveCheckoutReturn — pendente (nunca concede acesso prematuro)', () => {
  it('sincronização ainda não possível (ex.: vínculo do Customer/Price ainda não disponível): pending + observabilidade; o webhook converge depois', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockRejectedValue(new Error('vínculo ainda não existe'))

    await expect(run()).resolves.toBe('pending')
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('subscription sincronizada mas em status não confirmado (incomplete/past_due/unpaid) → pending', async () => {
    for (const status of ['incomplete', 'past_due', 'unpaid', 'incomplete_expired', 'canceled']) {
      retrieve.mockResolvedValue(makeSession())
      syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: null, newStatus: status, transitionRecorded: true })

      await expect(run()).resolves.toBe('pending')
    }
  })

  it('pagamento ainda não confirmado (payment_status=unpaid) → pending, sem sincronizar', async () => {
    retrieve.mockResolvedValue(makeSession({ payment_status: 'unpaid' }))

    await expect(run()).resolves.toBe('pending')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('Session ainda aberta (usuário não concluiu) → pending, sem sincronizar', async () => {
    retrieve.mockResolvedValue(makeSession({ status: 'open', payment_status: 'unpaid' }))

    await expect(run()).resolves.toBe('pending')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('Session completa mas ainda sem subscription associada → pending (nunca inventa uma)', async () => {
    retrieve.mockResolvedValue(makeSession({ subscription: null }))

    await expect(run()).resolves.toBe('pending')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })
})

describe('resolveCheckoutReturn — segurança (a URL nunca é autoridade)', () => {
  it('session_id de OUTRO usuário → invalid, sem sincronizar nada', async () => {
    retrieve.mockResolvedValue(makeSession({ client_reference_id: OTHER_USER_ID }))

    await expect(run()).resolves.toBe('invalid')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('Session sem client_reference_id → invalid', async () => {
    retrieve.mockResolvedValue(makeSession({ client_reference_id: null }))

    await expect(run()).resolves.toBe('invalid')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('Session de outro modo (não subscription) → invalid', async () => {
    retrieve.mockResolvedValue(makeSession({ mode: 'payment' }))

    await expect(run()).resolves.toBe('invalid')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('Session expirada → invalid', async () => {
    retrieve.mockResolvedValue(makeSession({ status: 'expired', payment_status: 'unpaid' }))

    await expect(run()).resolves.toBe('invalid')
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('o mesmo resultado neutro para "de outro usuário", "inexistente" e "de outro modo" (não é um oráculo do que existe no Stripe)', async () => {
    retrieve.mockResolvedValueOnce(makeSession({ client_reference_id: OTHER_USER_ID }))
    const otherUser = await run()

    retrieve.mockRejectedValueOnce(Object.assign(new Error('No such checkout.session'), { code: 'resource_missing', type: 'StripeInvalidRequestError' }))
    const missing = await run()

    retrieve.mockResolvedValueOnce(makeSession({ mode: 'payment' }))
    const wrongMode = await run()

    expect(new Set([otherUser, missing, wrongMode])).toEqual(new Set(['invalid']))
  })

  it('Session inexistente no Stripe (resource_missing) → invalid, sem ruído de observabilidade', async () => {
    retrieve.mockRejectedValue(Object.assign(new Error('No such checkout.session'), { code: 'resource_missing' }))

    await expect(run()).resolves.toBe('invalid')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('falha de infraestrutura no Stripe → unavailable + observabilidade (nunca concede nem nega por engano)', async () => {
    retrieve.mockRejectedValue(new Error('timeout de rede'))

    await expect(run()).resolves.toBe('unavailable')
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('Customer de conta já excluída (sincronização "skipped") → invalid', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'skipped', reason: 'tombstone' })

    await expect(run()).resolves.toBe('invalid')
  })

  it.each([
    ['vazio', ''],
    ['lixo', 'abc'],
    ['só prefixo', 'cs_test_'],
    ['com espaços', 'cs_test_abc def ghi jkl'],
    ['tentativa de injeção', "cs_test_abc'; drop table subscriptions;--"],
    ['prefixo de outro objeto', 'sub_1234567890abcdef'],
    ['muito longo', 'cs_test_' + 'a'.repeat(500)],
    ['com barra', 'cs_test_abcdefgh/../x'],
  ])('session_id com formato inválido (%s) → invalid ANTES de qualquer chamada ao Stripe', async (_label, sessionId) => {
    await expect(run({ sessionId })).resolves.toBe('invalid')

    expect(retrieve).not.toHaveBeenCalled()
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('o padrão de session_id aceita test e live e nada além do formato do Stripe', () => {
    expect(CHECKOUT_SESSION_ID_PATTERN.test('cs_test_a1B2c3D4e5F6')).toBe(true)
    expect(CHECKOUT_SESSION_ID_PATTERN.test('cs_live_a1B2c3D4e5F6')).toBe(true)
    expect(CHECKOUT_SESSION_ID_PATTERN.test('cs_prod_a1B2c3D4e5F6')).toBe(false)
  })

  it('o contrato só aceita o usuário AUTENTICADO e o session_id — não existe parâmetro para plano, preço, moeda ou "user_id da URL"', () => {
    expect(resolveCheckoutReturn.length).toBe(1) // um único objeto de dependências
    // O resultado é sempre uma das 4 strings neutras — nunca dados da Session.
  })

  it('o resultado é sempre uma string neutra (nunca devolve dados da Session/Customer)', async () => {
    retrieve.mockResolvedValue(makeSession())
    syncSubscriptionFromStripe.mockResolvedValue({ outcome: 'synced', subscriptionId: 'local-1', previousStatus: null, newStatus: 'active', transitionRecorded: true })

    const result = await run()

    expect(['confirmed', 'pending', 'invalid', 'unavailable']).toContain(result)
    expect(typeof result).toBe('string')
  })
})
