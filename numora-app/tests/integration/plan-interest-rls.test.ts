/**
 * tests/integration/plan-interest-rls.test.ts
 * TESTE DE SEGURANÇA (Etapa "5.10S — Pro Interest / Pré-lançamento"). Mesmo
 * espírito de tests/integration/feedback-rls.test.ts: roda contra Supabase
 * DEV real com sessões reais (nunca `service_role` para exercer os
 * caminhos testados — só para setup/cleanup e para promover um usuário a
 * admin). Chama a tabela `plan_interest` DIRETO via PostgREST (como um
 * atacante ou um bug no repository faria), nunca só através do repository —
 * é exatamente esse acesso direto que a RLS precisa barrar por si só.
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

describe.skipIf(!hasTestEnv())('plan_interest — RLS e autorização de admin', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let userA: DisposableUser
  let userB: DisposableUser
  let adminUser: DisposableUser
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientAdmin: SupabaseClient
  let planInterestAId: string

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    userA = await createDisposableUser(admin, 'plan-interest-a')
    userB = await createDisposableUser(admin, 'plan-interest-b')
    adminUser = await createDisposableUser(admin, 'plan-interest-admin')

    const { error: promoteError } = await admin.from('profiles').update({ role: 'admin' }).eq('id', adminUser.id)
    if (promoteError) {
      throw new Error(`[plan-interest-rls.test] Falha ao promover usuário a admin: ${promoteError.message}`)
    }

    clientA = await signInAsDisposableUser(env, userA)
    clientB = await signInAsDisposableUser(env, userB)
    clientAdmin = await signInAsDisposableUser(env, adminUser)

    const { data, error } = await clientA
      .from('plan_interest')
      .insert({ user_id: userA.id, plan_slug: 'pro', source: 'collection_limit' })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`[plan-interest-rls.test] setup falhou ao criar plan_interest de A: ${error?.message}`)
    }
    planInterestAId = data.id as string
  })

  afterAll(async () => {
    await deleteDisposableUser(admin, userA.id)
    await deleteDisposableUser(admin, userB.id)
    await deleteDisposableUser(admin, adminUser.id)
  })

  it('1. A consegue criar seu próprio registro de interesse (plan_slug/source preservados)', async () => {
    const { data, error } = await clientA.from('plan_interest').select('id, plan_slug, source').eq('id', planInterestAId).single()
    expect(error).toBeNull()
    expect(data?.plan_slug).toBe('pro')
    expect(data?.source).toBe('collection_limit')
  })

  it('2. A não consegue registrar interesse em nome de B (user_id != auth.uid()) — INSERT bloqueado pela RLS', async () => {
    const { data, error } = await clientA
      .from('plan_interest')
      .insert({ user_id: userB.id, plan_slug: 'premium', source: 'dashboard' })
      .select()
    expect(data).toBeNull()
    expect(error).not.toBeNull()

    const { data: check } = await admin.from('plan_interest').select('id').eq('user_id', userB.id)
    expect(check).toEqual([])
  })

  it('3. B não consegue ler o registro de interesse de A', async () => {
    const { data, error } = await clientB.from('plan_interest').select('id').eq('id', planInterestAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('4. E (implícito): B registrando o PRÓPRIO interesse não enxerga nem afeta o de A (UNIQUE é por usuário+plano, nunca global)', async () => {
    const { data, error } = await clientB
      .from('plan_interest')
      .insert({ user_id: userB.id, plan_slug: 'pro', source: 'dashboard' })
      .select('id, plan_slug')
      .single()
    expect(error).toBeNull()
    expect(data?.plan_slug).toBe('pro')

    const { data: aStillIntact } = await admin.from('plan_interest').select('user_id').eq('id', planInterestAId).single()
    expect(aStillIntact?.user_id).toBe(userA.id)
  })

  it('5. G: anon (sem sessão) não consegue inserir em plan_interest', async () => {
    const anon = createAnonClient(env)
    const { data, error } = await anon
      .from('plan_interest')
      .insert({ user_id: userA.id, plan_slug: 'premium', source: 'pricing_page' })
      .select()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('6. G: anon (sem sessão) não consegue ler plan_interest — negado já no nível de GRANT (mais forte que RLS-only: 42501, não um select vazio)', async () => {
    const anon = createAnonClient(env)
    const { data, error } = await anon.from('plan_interest').select('id')
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('7. D: plan_slug inválido é rejeitado pelo CHECK do banco, mesmo via API direta (defesa em profundidade além do repository)', async () => {
    const { data, error } = await clientA
      .from('plan_interest')
      .insert({ user_id: userA.id, plan_slug: 'enterprise', source: 'dashboard' })
      .select()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('8. C: segundo INSERT do mesmo usuário+plano é rejeitado pela UNIQUE do banco (base real da idempotência do repository)', async () => {
    const { data, error } = await clientA
      .from('plan_interest')
      .insert({ user_id: userA.id, plan_slug: 'pro', source: 'restore_limit' })
      .select()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23505')
  })

  it('9. Admin consegue ver o registro de interesse de A (plan_interest_select_admin)', async () => {
    const { data, error } = await clientAdmin.from('plan_interest').select('id, plan_slug').eq('id', planInterestAId).single()
    expect(error).toBeNull()
    expect(data?.plan_slug).toBe('pro')
  })

  it('10. Nenhuma linha de plan_interest expõe e-mail (coluna não existe na tabela)', async () => {
    const { data, error } = await clientA.from('plan_interest').select('*').eq('id', planInterestAId).single()
    expect(error).toBeNull()
    expect(data).not.toHaveProperty('email')
    expect(Object.keys(data as object).sort()).toEqual(['created_at', 'id', 'plan_slug', 'source', 'user_id'])
  })
})
