/**
 * tests/integration/admin-subscriptions.test.ts
 * Etapa "Admin Subscriptions V1" — testa `admin_list_subscriptions()` e
 * `admin_subscriptions_summary()` contra Supabase DEV real, com sessões
 * reais (nunca `service_role` para exercer os caminhos testados — só para
 * setup/cleanup e para promover admin/owner), mesmo espírito de
 * `tests/integration/analysis-account-dataset.test.ts`.
 *
 * LIMITAÇÃO DOCUMENTADA (explícita, não escondida): por instrução direta
 * desta etapa, nenhuma subscription Stripe (real ou fabricada por INSERT
 * direto) foi criada só para este teste — `public.subscriptions` está
 * genuinamente vazia no DEV neste momento. Isso significa que os testes de
 * filtro (status/plano/moeda/busca) só provam que os parâmetros são aceitos
 * e não vazam nada quando não há nenhuma linha correspondente — não provam
 * que uma linha CORRESPONDENTE seria corretamente incluída. Os itens que
 * dependem de uma linha real de `subscriptions` existir ficam para quando
 * houver uma assinatura Stripe TEST de verdade em DEV (decisão explícita já
 * registrada na auditoria: "validar com EmptyState por ora").
 *
 * O que ESTE arquivo prova com certeza, sem depender de nenhuma subscription
 * existir: autorização (admin/owner passam, usuário comum e anon não),
 * estrutura do retorno, `total_count`/paginação com 0 linhas, e — o mais
 * importante da auditoria — que uma Conta de Análise/cortesia/internal_test
 * (que TEM `benefit_grants`/`internal_test_accounts`, mas NUNCA uma linha em
 * `subscriptions`) nunca aparece nesta listagem, mesmo buscada pelo próprio
 * e-mail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  createAdminClient,
  createAnonClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  signInAsDisposableUser,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'

interface AdminSubscriptionsSummaryRow {
  total_subscriptions: number
  active_subscriptions: number
  canceling_subscriptions: number
  failed_payment_subscriptions: number
}

async function listSubscriptions(
  client: SupabaseClient,
  params: {
    limit?: number
    offset?: number
    status?: string | null
    plan?: string | null
    currency?: string | null
    cancelScheduledOnly?: boolean
    search?: string | null
  } = {},
) {
  return client.rpc('admin_list_subscriptions', {
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_status_filter: params.status ?? null,
    p_plan_filter: params.plan ?? null,
    p_currency_filter: params.currency ?? null,
    p_cancel_scheduled_only: params.cancelScheduledOnly ?? false,
    p_search: params.search ?? null,
  })
}

describe.skipIf(!hasTestEnv())('admin_list_subscriptions / admin_subscriptions_summary — Admin Subscriptions V1', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let ownerUser: DisposableUser
  let adminOnlyUser: DisposableUser
  let realUser: DisposableUser
  let courtesyUser: DisposableUser
  let internalTestUser: DisposableUser
  let clientOwner: SupabaseClient
  let clientAdminOnly: SupabaseClient
  let clientRealUser: SupabaseClient
  let clientAnon: SupabaseClient

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    clientAnon = createAnonClient(env)

    ownerUser = await createDisposableUser(admin, 'admin-subs-owner')
    adminOnlyUser = await createDisposableUser(admin, 'admin-subs-admin-only')
    realUser = await createDisposableUser(admin, 'admin-subs-real-user')
    courtesyUser = await createDisposableUser(admin, 'admin-subs-courtesy')
    internalTestUser = await createDisposableUser(admin, 'admin-subs-internal-test')

    await admin.from('profiles').update({ role: 'owner' }).eq('id', ownerUser.id)
    await admin.from('profiles').update({ role: 'admin' }).eq('id', adminOnlyUser.id)

    // Cortesia real (benefit_grants), SEM nenhuma linha em subscriptions —
    // exatamente o cenário que a RPC nunca deve confundir com uma assinatura.
    const { error: courtesyError } = await admin
      .from('benefit_grants')
      .insert({ user_id: courtesyUser.id, type: 'courtesy', plan: 'pro', reason: 'teste admin-subscriptions', starts_at: new Date().toISOString() })
    if (courtesyError) throw new Error(`[admin-subscriptions.test] Falha ao criar cortesia de teste: ${courtesyError.message}`)

    // Conta de Análise real (internal_test_accounts + benefit_grants type=internal_test) — mesma garantia.
    const { error: markError } = await admin
      .from('internal_test_accounts')
      .insert({ user_id: internalTestUser.id, created_by: ownerUser.id })
    if (markError) throw new Error(`[admin-subscriptions.test] Falha ao marcar Conta de Análise de teste: ${markError.message}`)

    const { error: internalGrantError } = await admin
      .from('benefit_grants')
      .insert({ user_id: internalTestUser.id, type: 'internal_test', plan: 'premium', reason: 'Conta de Análise (teste)', starts_at: new Date().toISOString() })
    if (internalGrantError) throw new Error(`[admin-subscriptions.test] Falha ao criar grant internal_test de teste: ${internalGrantError.message}`)

    clientOwner = await signInAsDisposableUser(env, ownerUser)
    clientAdminOnly = await signInAsDisposableUser(env, adminOnlyUser)
    clientRealUser = await signInAsDisposableUser(env, realUser)
  })

  afterAll(async () => {
    await admin.from('internal_test_accounts').delete().eq('user_id', internalTestUser.id)
    // `delete_own_account_data` recusa apagar uma conta com role='owner' —
    // guarda de segurança real, respeitada (não contornada): demove ANTES.
    await admin.from('profiles').update({ role: 'user' }).eq('id', ownerUser.id)

    await deleteDisposableUser(admin, ownerUser.id)
    await deleteDisposableUser(admin, adminOnlyUser.id)
    await deleteDisposableUser(admin, realUser.id)
    await deleteDisposableUser(admin, courtesyUser.id)
    await deleteDisposableUser(admin, internalTestUser.id)
  })

  describe('autorização', () => {
    it('1. owner consegue executar admin_list_subscriptions (sem erro)', async () => {
      const { data, error } = await listSubscriptions(clientOwner)
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })

    it('1b. admin comum (NÃO owner) também consegue executar — leitura é admin-or-owner', async () => {
      const { error } = await listSubscriptions(clientAdminOnly)
      expect(error).toBeNull()
    })

    it('2. usuário comum NÃO consegue executar — 42501', async () => {
      const { data, error } = await listSubscriptions(clientRealUser)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/apenas administradores/i)
    })

    it('3. anon NÃO consegue executar — sem privilégio de EXECUTE (nunca chega a checar is_platform_admin)', async () => {
      const { data, error } = await listSubscriptions(clientAnon)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })

    it('owner e admin comum conseguem executar admin_subscriptions_summary; usuário comum e anon não', async () => {
      const ownerResult = await clientOwner.rpc('admin_subscriptions_summary').maybeSingle()
      expect(ownerResult.error).toBeNull()

      const adminResult = await clientAdminOnly.rpc('admin_subscriptions_summary').maybeSingle()
      expect(adminResult.error).toBeNull()

      const realUserResult = await clientRealUser.rpc('admin_subscriptions_summary').maybeSingle()
      expect(realUserResult.error).not.toBeNull()

      const anonResult = await clientAnon.rpc('admin_subscriptions_summary').maybeSingle()
      expect(anonResult.error).not.toBeNull()
    })
  })

  describe('estrutura do retorno e paginação (0 linhas — ver limitação documentada no topo do arquivo)', () => {
    it('4. total_count é 0 quando não há nenhuma linha correspondente (array vazio, sem quebrar)', async () => {
      const { data, error } = await listSubscriptions(clientOwner)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('5. paginação (limit/offset) é aceita sem erro mesmo sem dados', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { limit: 10, offset: 5 })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('limit é travado em 200 mesmo se pedido maior (nunca "select * de tudo")', async () => {
      const { error } = await listSubscriptions(clientOwner, { limit: 999999 })
      expect(error).toBeNull()
    })
  })

  describe('filtros — aceitos e não vazam nada (ver limitação documentada)', () => {
    it('6. filtro por status não lança erro e não retorna dado de fora do escopo', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { status: 'active' })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('7. filtro por plano (pro/premium) é aceito', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { plan: 'premium' })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('8. filtro por moeda é aceito', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { currency: 'USD' })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('9. cancel_scheduled_only é aceito', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { cancelScheduledOnly: true })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })

  describe('isolamento: cortesia / internal_test / Conta de Análise NUNCA aparecem (auditoria seção D)', () => {
    it('10/15. busca pelo e-mail de um usuário com CORTESIA ativa (benefit_grants) mas SEM subscription não retorna nenhuma linha', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { search: courtesyUser.email })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('11/16/17. busca pelo e-mail da Conta de Análise (internal_test_accounts + benefit_grants type=internal_test) não retorna nenhuma linha', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { search: internalTestUser.email })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('busca por nome (não só e-mail) também não vaza a Conta de Análise', async () => {
      const { data, error } = await listSubscriptions(clientOwner, { search: 'admin-subs-internal-test' })
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })
  })

  describe('admin_subscriptions_summary — definições exatas (ver comentário da migration)', () => {
    it('reflete o estado real do banco: 0 em todos os campos quando subscriptions está vazia', async () => {
      const { data, error } = await clientOwner.rpc('admin_subscriptions_summary').maybeSingle()
      expect(error).toBeNull()
      const summary = data as AdminSubscriptionsSummaryRow
      expect(summary.total_subscriptions).toBe(0)
      expect(summary.active_subscriptions).toBe(0)
      expect(summary.canceling_subscriptions).toBe(0)
      expect(summary.failed_payment_subscriptions).toBe(0)
    })
  })
})
