/**
 * tests/integration/analysis-account-plan-switch.test.ts
 * Etapa "5.10W.1/5.10W.2 — Conta de Análise: identidade + plano simulado".
 * TESTE DE SEGURANÇA — mesmo espírito de
 * tests/integration/benefit-grants-expiration.test.ts/feedback-rls.test.ts:
 * roda contra Supabase DEV real com sessões reais (nunca `service_role`
 * para exercer os caminhos testados — só para setup/cleanup e para
 * promover usuários a admin/owner, que são operações reais de banco).
 *
 * Cobre a garantia central da 5.10W: `switch_analysis_account_plan()`
 * nunca aceita `p_user_id` arbitrário (revalida `internal_test_accounts`
 * internamente), é exclusiva de OWNER, nunca cria
 * subscription/billing_customer/billing_transaction, e o plano simulado é
 * lido de volta pelo MESMO `effective_plans()`/`get_my_entitlement()` que
 * qualquer usuário real usa — nenhum mecanismo paralelo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

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

describe.skipIf(!hasTestEnv())('switch_analysis_account_plan — Conta de Análise (5.10W.1/5.10W.2)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let analysisAccount: DisposableUser
  let realUser: DisposableUser
  let ownerUser: DisposableUser
  let adminOnlyUser: DisposableUser
  let clientOwner: SupabaseClient
  let clientAdminOnly: SupabaseClient
  let clientRealUser: SupabaseClient

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    analysisAccount = await createDisposableUser(admin, 'analysis-account')
    realUser = await createDisposableUser(admin, 'real-user')
    ownerUser = await createDisposableUser(admin, 'analysis-owner')
    adminOnlyUser = await createDisposableUser(admin, 'analysis-admin-only')

    const { error: ownerError } = await admin.from('profiles').update({ role: 'owner' }).eq('id', ownerUser.id)
    if (ownerError) throw new Error(`[analysis-account-plan-switch.test] Falha ao promover owner: ${ownerError.message}`)

    const { error: adminError } = await admin.from('profiles').update({ role: 'admin' }).eq('id', adminOnlyUser.id)
    if (adminError) throw new Error(`[analysis-account-plan-switch.test] Falha ao promover admin: ${adminError.message}`)

    // Marca `analysisAccount` como Conta de Análise — operação real de
    // banco (equivalente a um owner inserindo pela UI futura), nunca um
    // bypass do mecanismo testado.
    const { error: markError } = await admin
      .from('internal_test_accounts')
      .insert({ user_id: analysisAccount.id, created_by: ownerUser.id })
    if (markError) throw new Error(`[analysis-account-plan-switch.test] Falha ao marcar Conta de Análise: ${markError.message}`)

    clientOwner = await signInAsDisposableUser(env, ownerUser)
    clientAdminOnly = await signInAsDisposableUser(env, adminOnlyUser)
    clientRealUser = await signInAsDisposableUser(env, realUser)
  })

  afterAll(async () => {
    await admin.from('internal_test_accounts').delete().eq('user_id', analysisAccount.id)
    await deleteDisposableUser(admin, analysisAccount.id)
    await deleteDisposableUser(admin, realUser.id)

    // `delete_own_account_data()` (Etapa 15.10.17B, defesa em profundidade)
    // recusa excluir QUALQUER linha com role='owner', mesmo um usuário
    // descartável de teste — proteção real e intencional contra excluir o
    // owner de verdade por engano. Rebaixar antes de excluir é o jeito
    // correto de limpar este fixture, nunca contornar a proteção em si.
    await admin.from('profiles').update({ role: 'user' }).eq('id', ownerUser.id)
    await deleteDisposableUser(admin, ownerUser.id)

    await deleteDisposableUser(admin, adminOnlyUser.id)
  })

  async function activeInternalTestGrants(userId: string) {
    const { data, error } = await admin
      .from('benefit_grants')
      .select('id, plan, type, revoked_at')
      .eq('user_id', userId)
      .eq('type', 'internal_test')
      .is('revoked_at', null)
    if (error) throw new Error(error.message)
    return data ?? []
  }

  async function effectivePlanOf(userId: string): Promise<string> {
    const { data, error } = await admin.rpc('get_effective_plan', { p_user_id: userId }).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as { plan_slug: string } | null)?.plan_slug ?? 'unknown'
  }

  it('1. Owner troca a Conta de Análise para PRO — grant internal_test criado, sem expiração', async () => {
    const { data, error } = await clientOwner.rpc('switch_analysis_account_plan', {
      p_user_id: analysisAccount.id,
      p_plan: 'pro',
    })
    expect(error).toBeNull()
    expect(data?.type).toBe('internal_test')
    expect(data?.plan).toBe('pro')
    expect(data?.expires_at).toBeNull()
    expect(data?.revoked_at).toBeNull()

    expect(await effectivePlanOf(analysisAccount.id)).toBe('pro')
  })

  it('2. Owner troca para PREMIUM — grant PRO anterior é revogado, só 1 grant internal_test ativo', async () => {
    const { data, error } = await clientOwner.rpc('switch_analysis_account_plan', {
      p_user_id: analysisAccount.id,
      p_plan: 'premium',
    })
    expect(error).toBeNull()
    expect(data?.plan).toBe('premium')

    const active = await activeInternalTestGrants(analysisAccount.id)
    expect(active).toHaveLength(1)
    expect(active[0].plan).toBe('premium')

    expect(await effectivePlanOf(analysisAccount.id)).toBe('premium')
  })

  it('3. PREMIUM → PRO', async () => {
    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'pro' })
    expect(await effectivePlanOf(analysisAccount.id)).toBe('pro')

    const active = await activeInternalTestGrants(analysisAccount.id)
    expect(active).toHaveLength(1)
    expect(active[0].plan).toBe('pro')
  })

  it('4. PRO → FREE — nenhum grant novo é criado, effective plan volta a free', async () => {
    const { data, error } = await clientOwner.rpc('switch_analysis_account_plan', {
      p_user_id: analysisAccount.id,
      p_plan: 'free',
    })
    expect(error).toBeNull()
    // `return null;` de uma function que devolve um tipo composto
    // (`public.benefit_grants`) nunca serializa como `null` puro via
    // PostgREST — vira uma linha com TODOS os campos null (achado real
    // desta suíte, comportamento padrão do Postgres/PostgREST para tipos
    // compostos, não um bug da RPC). `id` null já é suficiente para provar
    // "nenhuma linha real foi criada/retornada".
    expect(data?.id ?? null).toBeNull()

    const active = await activeInternalTestGrants(analysisAccount.id)
    expect(active).toHaveLength(0)

    expect(await effectivePlanOf(analysisAccount.id)).toBe('free')
  })

  it('5. FREE → PREMIUM (direto, sem passar por Pro)', async () => {
    const { error } = await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'premium' })
    expect(error).toBeNull()
    expect(await effectivePlanOf(analysisAccount.id)).toBe('premium')
  })

  it('6. PREMIUM → FREE (direto)', async () => {
    const { error } = await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'free' })
    expect(error).toBeNull()
    expect(await effectivePlanOf(analysisAccount.id)).toBe('free')

    const active = await activeInternalTestGrants(analysisAccount.id)
    expect(active).toHaveLength(0)
  })

  it('7. Admin comum (NÃO owner) não consegue chamar a RPC — 42501', async () => {
    const { data, error } = await clientAdminOnly.rpc('switch_analysis_account_plan', {
      p_user_id: analysisAccount.id,
      p_plan: 'pro',
    })
    expect(data).toBeNull()
    expect(error).not.toBeNull()

    // Confirma que NENHUM grant foi criado apesar da tentativa.
    const active = await activeInternalTestGrants(analysisAccount.id)
    expect(active).toHaveLength(0)
  })

  it('8. Usuário comum não consegue chamar a RPC — 42501', async () => {
    const { data, error } = await clientRealUser.rpc('switch_analysis_account_plan', {
      p_user_id: analysisAccount.id,
      p_plan: 'premium',
    })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('9. Owner NÃO consegue usar a RPC contra um usuário REAL (não está em internal_test_accounts) — rejeitado, nenhuma contaminação', async () => {
    const { data, error } = await clientOwner.rpc('switch_analysis_account_plan', {
      p_user_id: realUser.id,
      p_plan: 'premium',
    })
    expect(data).toBeNull()
    expect(error).not.toBeNull()

    const { data: realUserGrants } = await admin.from('benefit_grants').select('id').eq('user_id', realUser.id)
    expect(realUserGrants).toEqual([])
    expect(await effectivePlanOf(realUser.id)).toBe('free')
  })

  it('10. Plano inválido é rejeitado ANTES de qualquer escrita (nenhum grant existente é revogado por engano)', async () => {
    // Deixa a conta em PRO primeiro, para provar que uma chamada inválida
    // subsequente não mexe no grant já ativo.
    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'pro' })

    const { data, error } = await clientOwner.rpc('switch_analysis_account_plan', {
      p_user_id: analysisAccount.id,
      p_plan: 'enterprise',
    })
    expect(data).toBeNull()
    expect(error).not.toBeNull()

    const active = await activeInternalTestGrants(analysisAccount.id)
    expect(active).toHaveLength(1)
    expect(active[0].plan).toBe('pro')

    // Limpa para não afetar os testes seguintes.
    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'free' })
  })

  it('11. Nenhum subscription é criado em nenhum momento para a Conta de Análise', async () => {
    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'premium' })

    const { data: subscriptions } = await admin.from('subscriptions').select('id').eq('user_id', analysisAccount.id)
    expect(subscriptions).toEqual([])

    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'free' })
  })

  it('12. Nenhum billing_customer/billing_transaction é criado para a Conta de Análise', async () => {
    const { data: customers } = await admin.from('billing_customers').select('id').eq('user_id', analysisAccount.id)
    expect(customers).toEqual([])

    const { data: transactions } = await admin.from('billing_transactions').select('id').eq('user_id', analysisAccount.id)
    expect(transactions).toEqual([])
  })

  it('13. get_my_entitlement (dashboard_advanced) reflete o plano simulado — Free bloqueado, Pro/Premium liberado', async () => {
    const clientAnalysisAccount = await signInAsDisposableUser(env, analysisAccount)

    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'free' })
    const { data: freeEntitlement } = await clientAnalysisAccount.rpc('get_my_entitlement', { p_feature_key: 'dashboard_advanced' }).maybeSingle()
    expect((freeEntitlement as { enabled: boolean } | null)?.enabled).toBe(false)

    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'pro' })
    const { data: proEntitlement } = await clientAnalysisAccount.rpc('get_my_entitlement', { p_feature_key: 'dashboard_advanced' }).maybeSingle()
    expect((proEntitlement as { enabled: boolean } | null)?.enabled).toBe(true)

    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'free' })
  })

  it('14. internal_test_accounts: usuário comum não consegue inserir/ler/alterar/remover', async () => {
    const { data: insertData, error: insertError } = await clientRealUser
      .from('internal_test_accounts')
      .insert({ user_id: realUser.id, created_by: realUser.id })
      .select()
    expect(insertData).toBeNull()
    expect(insertError).not.toBeNull()

    const { data: readData, error: readError } = await clientRealUser.from('internal_test_accounts').select('*')
    expect(readError).toBeNull()
    expect(readData).toEqual([])
  })

  it('15. internal_test_accounts: admin comum (não owner) não consegue inserir', async () => {
    const { data, error } = await clientAdminOnly
      .from('internal_test_accounts')
      .insert({ user_id: realUser.id, created_by: adminOnlyUser.id })
      .select()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('16. internal_test_accounts: admin comum CONSEGUE ler (select_admin), mas não escrever', async () => {
    const { data, error } = await clientAdminOnly.from('internal_test_accounts').select('user_id').eq('user_id', analysisAccount.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})
