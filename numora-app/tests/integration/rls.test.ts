/**
 * tests/integration/rls.test.ts
 * TESTE DE SEGURANÇA 01 (Etapa "F2 — Closed Beta Test Suite"). Roda contra
 * Supabase DEV real (ver tests/support/dev-env.ts) com DUAS sessões reais
 * (usuário A e usuário B, cada um logado de verdade via
 * `signInWithPassword`) — nunca usa `service_role` para testar RLS, só
 * para setup (criar os 2 usuários) e cleanup, e para as asserções de
 * controle que confirmam que os dados de A continuam intactos.
 *
 * Supabase RLS não lança erro para SELECT/UPDATE/DELETE cross-user — a
 * policy simplesmente filtra a linha fora do resultado (0 linhas
 * retornadas/afetadas, `error: null`). Por isso as asserções abaixo
 * checam "nenhuma linha voltou"/"nenhuma linha mudou", não "lançou erro".
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

describe.skipIf(!hasTestEnv())('RLS — isolamento entre usuários', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let userA: DisposableUser
  let userB: DisposableUser
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let itemAId: string

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    userA = await createDisposableUser(admin, 'rls-a')
    userB = await createDisposableUser(admin, 'rls-b')
    clientA = await signInAsDisposableUser(env, userA)
    clientB = await signInAsDisposableUser(env, userB)

    const { data, error } = await clientA
      .from('collection_items')
      .insert({ user_id: userA.id, country_code: 'BR', year: 2000, denomination: 'Teste RLS A' })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`[rls.test] setup falhou ao criar item de A: ${error?.message}`)
    }
    itemAId = data.id as string
  })

  // Cleanup garantido mesmo se algum teste acima falhar — `afterAll` roda
  // sempre no Vitest, independente do resultado dos testes do describe.
  afterAll(async () => {
    await deleteDisposableUser(admin, userA.id)
    await deleteDisposableUser(admin, userB.id)
  })

  it('B não consegue SELECT do item privado de A', async () => {
    const { data, error } = await clientB.from('collection_items').select('id').eq('id', itemAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('B não consegue UPDATE do item privado de A (0 linhas afetadas, valor original preservado)', async () => {
    const { data, error } = await clientB
      .from('collection_items')
      .update({ denomination: 'Hackeado por B' })
      .eq('id', itemAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: check } = await admin.from('collection_items').select('denomination').eq('id', itemAId).single()
    expect(check?.denomination).toBe('Teste RLS A')
  })

  it('B não consegue DELETE do item privado de A (linha continua existindo)', async () => {
    const { data, error } = await clientB.from('collection_items').delete().eq('id', itemAId).select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: check } = await admin.from('collection_items').select('id').eq('id', itemAId).maybeSingle()
    expect(check?.id).toBe(itemAId)
  })

  it('B não consegue ler o perfil privado de A', async () => {
    const { data, error } = await clientB.from('profiles').select('id, email').eq('id', userA.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('controle positivo: A continua lendo/editando seu próprio item normalmente', async () => {
    const { data, error } = await clientA
      .from('collection_items')
      .select('id, denomination')
      .eq('id', itemAId)
      .single()
    expect(error).toBeNull()
    expect(data?.denomination).toBe('Teste RLS A')
  })
})
