/**
 * tests/integration/labels-entitlement.test.ts
 * TESTE DE SEGURANÇA (Etapa "F4 — Numora Labels"). Mesmo espírito de
 * tests/integration/rls.test.ts/feedback-rls.test.ts: sessões reais contra
 * DEV, `service_role` só para setup (criar usuários, promover a Pro/Premium
 * via `benefit_grants` — o único mecanismo de plano pago que existe hoje,
 * já que não há billing real) e cleanup.
 *
 * `ensure_label_codes()` é a ÚNICA barreira real (RPC SECURITY DEFINER,
 * fail-closed via `get_entitlement`) — os testes abaixo chamam a RPC
 * DIRETO como um atacante/cliente de API faria, nunca através de uma UI
 * simulada.
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

async function grantPlan(admin: SupabaseClient, userId: string, plan: 'pro' | 'premium'): Promise<void> {
  const { error } = await admin.from('benefit_grants').insert({
    user_id: userId,
    type: 'beta',
    plan,
    reason: 'F4 Labels — integration test',
    created_by: userId,
  })
  if (error) throw new Error(`[labels-entitlement.test] Falha ao conceder plano ${plan}: ${error.message}`)
}

describe.skipIf(!hasTestEnv())('Labels — entitlement e autorização (ensure_label_codes)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let freeUser: DisposableUser
  let proUser: DisposableUser
  let premiumUser: DisposableUser
  let otherUser: DisposableUser
  let clientFree: SupabaseClient
  let clientPro: SupabaseClient
  let clientPremium: SupabaseClient
  let clientOther: SupabaseClient
  let freeItemId: string
  let proItemId: string
  let premiumItemId: string
  let otherItemId: string
  let deletedItemId: string

  async function createItem(client: SupabaseClient, userId: string, denomination: string): Promise<string> {
    const { data, error } = await client
      .from('collection_items')
      .insert({ user_id: userId, country_code: 'BR', year: 2000, denomination })
      .select('id')
      .single()
    if (error || !data) throw new Error(`[labels-entitlement.test] Falha ao criar item: ${error?.message}`)
    return data.id as string
  }

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    freeUser = await createDisposableUser(admin, 'labels-free')
    proUser = await createDisposableUser(admin, 'labels-pro')
    premiumUser = await createDisposableUser(admin, 'labels-premium')
    otherUser = await createDisposableUser(admin, 'labels-other')

    await grantPlan(admin, proUser.id, 'pro')
    await grantPlan(admin, premiumUser.id, 'premium')

    clientFree = await signInAsDisposableUser(env, freeUser)
    clientPro = await signInAsDisposableUser(env, proUser)
    clientPremium = await signInAsDisposableUser(env, premiumUser)
    clientOther = await signInAsDisposableUser(env, otherUser)

    freeItemId = await createItem(clientFree, freeUser.id, 'Item Free')
    proItemId = await createItem(clientPro, proUser.id, 'Item Pro')
    premiumItemId = await createItem(clientPremium, premiumUser.id, 'Item Premium')
    otherItemId = await createItem(clientOther, otherUser.id, 'Item de Outro Usuário')

    deletedItemId = await createItem(clientPro, proUser.id, 'Item Pro Excluído')
    const { error: deleteError } = await clientPro
      .from('collection_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deletedItemId)
    if (deleteError) throw new Error(`[labels-entitlement.test] Falha ao mover item para lixeira: ${deleteError.message}`)
  })

  afterAll(async () => {
    await deleteDisposableUser(admin, freeUser.id)
    await deleteDisposableUser(admin, proUser.id)
    await deleteDisposableUser(admin, premiumUser.id)
    await deleteDisposableUser(admin, otherUser.id)
  })

  it('1. get_my_entitlement("labels") retorna enabled=false para Free', async () => {
    const { data, error } = await clientFree
      .rpc('get_my_entitlement', { p_feature_key: 'labels' })
      .single<{ enabled: boolean }>()
    expect(error).toBeNull()
    expect(data?.enabled).toBe(false)
  })

  it('8. get_my_entitlement("labels") retorna enabled=true para Pro e Premium', async () => {
    const { data: pro } = await clientPro
      .rpc('get_my_entitlement', { p_feature_key: 'labels' })
      .single<{ enabled: boolean }>()
    expect(pro?.enabled).toBe(true)
    const { data: premium } = await clientPremium
      .rpc('get_my_entitlement', { p_feature_key: 'labels' })
      .single<{ enabled: boolean }>()
    expect(premium?.enabled).toBe(true)
  })

  it('2. Free chamando ensure_label_codes diretamente recebe 42501', async () => {
    const { data, error } = await clientFree.rpc('ensure_label_codes', { p_item_ids: [freeItemId] })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('3. Pro consegue gerar label_code para o próprio item', async () => {
    const { data, error } = await clientPro.rpc('ensure_label_codes', { p_item_ids: [proItemId] })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].label_code).toMatch(/^NMR-\d{7}$/)
  })

  it('4. Premium (via benefit_grants) consegue gerar label_code', async () => {
    const { data, error } = await clientPremium.rpc('ensure_label_codes', { p_item_ids: [premiumItemId] })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].label_code).toMatch(/^NMR-\d{7}$/)
  })

  it('5. chamada repetida devolve o MESMO label_code (idempotente, nunca reatribui)', async () => {
    const { data: first } = await clientPro.rpc('ensure_label_codes', { p_item_ids: [proItemId] })
    const { data: second } = await clientPro.rpc('ensure_label_codes', { p_item_ids: [proItemId] })
    expect(first![0].label_code).toBe(second![0].label_code)
  })

  it('6. A (Pro) não consegue gerar label_code para item de B — nem em lote com um item próprio', async () => {
    const { data: soloAttempt, error: soloError } = await clientPro.rpc('ensure_label_codes', {
      p_item_ids: [otherItemId],
    })
    expect(soloAttempt).toBeNull()
    expect(soloError?.code).toBe('42501')

    // "sem cenário parcial": mesmo com 1 item próprio válido no lote, a
    // presença de 1 item alheio deve abortar a chamada inteira.
    const freshItemId = await createItem(clientPro, proUser.id, 'Item Pro (lote misto)')
    const { data: mixedAttempt, error: mixedError } = await clientPro.rpc('ensure_label_codes', {
      p_item_ids: [freshItemId, otherItemId],
    })
    expect(mixedAttempt).toBeNull()
    expect(mixedError?.code).toBe('42501')

    const { data: check } = await admin.from('collection_items').select('label_code').eq('id', freshItemId).single()
    expect(check?.label_code).toBeNull()
  })

  it('7. item na lixeira (deleted_at preenchido) não pode receber label_code', async () => {
    const { data, error } = await clientPro.rpc('ensure_label_codes', { p_item_ids: [deletedItemId] })
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('13. label_code não pode ser alterado diretamente via UPDATE (GRANT column-level nega)', async () => {
    await clientPro.rpc('ensure_label_codes', { p_item_ids: [proItemId] })

    const { data, error } = await clientPro
      .from('collection_items')
      .update({ label_code: 'NMR-9999999' })
      .eq('id', proItemId)
      .select()

    // REVOKE UPDATE (label_code) faz o PostgREST recusar a coluna inteira
    // na cláusula SET — erro de permissão, nunca uma atualização silenciosa.
    expect(data).toBeNull()
    expect(error).not.toBeNull()

    const { data: check } = await admin.from('collection_items').select('label_code').eq('id', proItemId).single()
    expect(check?.label_code).toMatch(/^NMR-\d{7}$/)
    expect(check?.label_code).not.toBe('NMR-9999999')
  })
})
