/**
 * tests/integration/feedback-rls.test.ts
 * TESTE DE SEGURANÇA (Etapa "F3 — Numora Feedback"). Mesmo espírito de
 * tests/integration/rls.test.ts: roda contra Supabase DEV real com
 * sessões reais (nunca `service_role` para exercer os caminhos testados —
 * só para setup/cleanup e para promover um usuário a admin, que é uma
 * operação real de banco, não um bypass de RLS).
 *
 * Cobre o achado de segurança desta etapa: `admin_notes` vive em
 * `feedback_admin_notes`, tabela separada com RLS restrita a
 * `is_platform_admin()` — os testes de "usuário comum não acessa
 * admin_notes" chamam a tabela DIRETO (como um atacante faria via REST),
 * nunca passando pelo repository, porque é exatamente esse acesso direto
 * que a arquitetura em 2 tabelas precisa barrar.
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

describe.skipIf(!hasTestEnv())('Feedback — RLS e autorização de admin', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let userA: DisposableUser
  let userB: DisposableUser
  let adminUser: DisposableUser
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientAdmin: SupabaseClient
  let feedbackAId: string

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    userA = await createDisposableUser(admin, 'feedback-a')
    userB = await createDisposableUser(admin, 'feedback-b')
    adminUser = await createDisposableUser(admin, 'feedback-admin')

    // Promover a admin é uma operação real de banco (equivalente a um
    // owner mudando `profiles.role` pelo painel) — não é um bypass do
    // mecanismo testado, é como um admin de verdade passa a existir.
    const { error: promoteError } = await admin.from('profiles').update({ role: 'admin' }).eq('id', adminUser.id)
    if (promoteError) {
      throw new Error(`[feedback-rls.test] Falha ao promover usuário a admin: ${promoteError.message}`)
    }

    clientA = await signInAsDisposableUser(env, userA)
    clientB = await signInAsDisposableUser(env, userB)
    clientAdmin = await signInAsDisposableUser(env, adminUser)

    const { data, error } = await clientA
      .from('feedbacks')
      .insert({ user_id: userA.id, type: 'suggestion', title: 'Feedback de A', message: 'Mensagem de A' })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`[feedback-rls.test] setup falhou ao criar feedback de A: ${error?.message}`)
    }
    feedbackAId = data.id as string
  })

  afterAll(async () => {
    await deleteDisposableUser(admin, userA.id)
    await deleteDisposableUser(admin, userB.id)
    await deleteDisposableUser(admin, adminUser.id)
  })

  it('1. A consegue criar um feedback', async () => {
    const { data, error } = await clientA
      .from('feedbacks')
      .select('id, title, status, priority')
      .eq('id', feedbackAId)
      .single()
    expect(error).toBeNull()
    expect(data?.title).toBe('Feedback de A')
    expect(data?.status).toBe('new')
    expect(data?.priority).toBe('medium')
  })

  it('2. A só enxerga o próprio feedback (nunca o de outra pessoa fictícia) via listOwn', async () => {
    const { data, error } = await clientA.from('feedbacks').select('id').eq('id', feedbackAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('3. B não consegue ler o feedback de A', async () => {
    const { data, error } = await clientB.from('feedbacks').select('id').eq('id', feedbackAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('4. B não consegue alterar o feedback de A (0 linhas afetadas, dados de A preservados)', async () => {
    const { data, error } = await clientB
      .from('feedbacks')
      .update({ status: 'dismissed', priority: 'critical' })
      .eq('id', feedbackAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: check } = await admin.from('feedbacks').select('status, priority').eq('id', feedbackAId).single()
    expect(check?.status).toBe('new')
    expect(check?.priority).toBe('medium')
  })

  it('5. A (usuário comum, dono do próprio feedback) não consegue alterar status/priority — nenhuma policy de UPDATE para o autor', async () => {
    const { data, error } = await clientA
      .from('feedbacks')
      .update({ status: 'completed', priority: 'critical' })
      .eq('id', feedbackAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: check } = await admin.from('feedbacks').select('status, priority').eq('id', feedbackAId).single()
    expect(check?.status).toBe('new')
    expect(check?.priority).toBe('medium')
  })

  it('6. A não consegue ler nem escrever em feedback_admin_notes do próprio feedback via API direta', async () => {
    const { data: readAttempt, error: readError } = await clientA
      .from('feedback_admin_notes')
      .select('*')
      .eq('feedback_id', feedbackAId)
    expect(readError).toBeNull()
    expect(readAttempt).toEqual([])

    const { data: writeAttempt, error: writeError } = await clientA
      .from('feedback_admin_notes')
      .insert({ feedback_id: feedbackAId, notes: 'Nota que A tentou inserir para si mesmo' })
      .select()
    expect(writeAttempt).toBeNull()
    expect(writeError).not.toBeNull()
  })

  it('7. Admin consegue ver o feedback de A (feedbacks_select_admin)', async () => {
    const { data, error } = await clientAdmin.from('feedbacks').select('id, title').eq('id', feedbackAId).single()
    expect(error).toBeNull()
    expect(data?.title).toBe('Feedback de A')
  })

  it('8. Admin consegue alterar status e priority do feedback de A', async () => {
    const { data, error } = await clientAdmin
      .from('feedbacks')
      .update({ status: 'in_progress', priority: 'high' })
      .eq('id', feedbackAId)
      .select('status, priority')
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('in_progress')
    expect(data?.priority).toBe('high')
  })

  it('9. Admin consegue criar/atualizar a observação interna (feedback_admin_notes) do feedback de A', async () => {
    const { error: upsertError } = await clientAdmin
      .from('feedback_admin_notes')
      .upsert({ feedback_id: feedbackAId, notes: 'Observação interna do admin' }, { onConflict: 'feedback_id' })
    expect(upsertError).toBeNull()

    const { data, error } = await clientAdmin
      .from('feedback_admin_notes')
      .select('notes')
      .eq('feedback_id', feedbackAId)
      .single()
    expect(error).toBeNull()
    expect(data?.notes).toBe('Observação interna do admin')

    // Controle: mesmo depois de existir, A continua sem conseguir lê-la.
    const { data: stillBlocked, error: stillBlockedError } = await clientA
      .from('feedback_admin_notes')
      .select('*')
      .eq('feedback_id', feedbackAId)
    expect(stillBlockedError).toBeNull()
    expect(stillBlocked).toEqual([])
  })
})
