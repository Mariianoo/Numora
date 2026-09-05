/**
 * tests/integration/labels-passport-item.test.ts
 * Etapa "F4 — Numora Labels" — `get_public_passport_item()`, o destino do
 * QR Code impresso na etiqueta. Chamada via client ANÔNIMO (nunca logado —
 * é exatamente assim que um celular escaneando o QR acessaria), mesmo
 * espírito de tests/integration/public-passport.test.ts.
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

interface PassportItemResult {
  username: string
  coin: { denomination: string | null; labelCode: string | null }
}

describe.skipIf(!hasTestEnv())('Labels — get_public_passport_item (Passport individual)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let anon: SupabaseClient
  let user: DisposableUser
  let username: string
  let allModeItemId: string
  let selectedModeVisibleItemId: string
  let selectedModeHiddenItemId: string
  let deletedItemId: string

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    anon = createAnonClient(env)
    user = await createDisposableUser(admin, 'labels-passport-item')

    username = `f4item${Date.now()}`.slice(0, 24)
    const userClient = await signInAsDisposableUser(env, user)

    const { error: profileError } = await admin
      .from('profiles')
      .update({ username, passport_public: true, passport_collection_visibility: 'selected' })
      .eq('id', user.id)
    if (profileError) throw new Error(`[labels-passport-item.test] Falha ao configurar perfil: ${profileError.message}`)

    async function createItem(denomination: string, isPublic: boolean): Promise<string> {
      const { data, error } = await userClient
        .from('collection_items')
        .insert({ user_id: user.id, country_code: 'BR', year: 2000, denomination, is_public: isPublic })
        .select('id')
        .single()
      if (error || !data) throw new Error(`[labels-passport-item.test] Falha ao criar item: ${error?.message}`)
      return data.id as string
    }

    selectedModeVisibleItemId = await createItem('Item Visível (selected)', true)
    selectedModeHiddenItemId = await createItem('Item Oculto (selected)', false)

    deletedItemId = await createItem('Item Excluído', true)
    await admin.from('collection_items').update({ deleted_at: new Date().toISOString() }).eq('id', deletedItemId)

    // Item usado no cenário "modo all" — criado direto pelo admin já com
    // is_public=false (irrelevante nesse modo) para não depender de mudar o
    // modo do perfil no meio do teste.
    const { data: allItem, error: allItemError } = await admin
      .from('collection_items')
      .insert({ user_id: user.id, country_code: 'US', year: 1999, denomination: 'Item Modo All' })
      .select('id')
      .single()
    if (allItemError || !allItem) throw new Error(`[labels-passport-item.test] Falha ao criar item modo all: ${allItemError?.message}`)
    allModeItemId = allItem.id as string
  })

  afterAll(async () => {
    await deleteDisposableUser(admin, user.id)
  })

  it('9. item privado (modo selected, is_public=false) → null', async () => {
    const { data, error } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: selectedModeHiddenItemId,
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('10. item público (modo selected, is_public=true) → dados corretos', async () => {
    const { data, error } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: selectedModeVisibleItemId,
    })
    expect(error).toBeNull()
    const result = data as PassportItemResult
    expect(result.username).toBe(username)
    expect(result.coin.denomination).toBe('Item Visível (selected)')
  })

  it('item excluído (na lixeira) → null, mesmo estando is_public=true', async () => {
    const { data } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: deletedItemId,
    })
    expect(data).toBeNull()
  })

  it('username inexistente → null (mesmo formato de resposta que item privado)', async () => {
    const { data } = await anon.rpc('get_public_passport_item', {
      p_username: 'usuario-que-nao-existe-f4',
      p_item_id: selectedModeVisibleItemId,
    })
    expect(data).toBeNull()
  })

  it('item existe mas pertence a outro contexto de visibilidade (fora do modo selected) → null após mudar para modo none', async () => {
    const { error: switchError } = await admin
      .from('profiles')
      .update({ passport_collection_visibility: 'none' })
      .eq('id', user.id)
    if (switchError) throw switchError

    const { data } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: selectedModeVisibleItemId,
    })
    expect(data).toBeNull()

    // modo 'all' — qualquer item ativo do usuário passa a ser visível,
    // independente de is_public.
    await admin.from('profiles').update({ passport_collection_visibility: 'all' }).eq('id', user.id)
    const { data: nowVisible } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: allModeItemId,
    })
    expect((nowVisible as PassportItemResult | null)?.coin.denomination).toBe('Item Modo All')
  })

  it('11. nunca retorna custo/preço/e-mail/dados privados', async () => {
    const { data } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: allModeItemId,
    })
    const json = JSON.stringify(data)
    expect(json).not.toMatch(/purchase_id|unit_cost|unitCost|email|e-mail|location|description|mint|history|trivia|catalog/i)
  })

  it('12. o item usa o UUID interno na chamada, nunca o label_code', async () => {
    // O próprio teste já chama a RPC com o UUID (`allModeItemId`) em todos
    // os cenários acima — este teste confirma explicitamente que a RPC
    // NÃO aceita/reconhece um label_code no lugar do id (retorna null, não
    // trata como um alias válido).
    const { data } = await anon.rpc('get_public_passport_item', {
      p_username: username,
      p_item_id: 'NMR-0000001',
    })
    expect(data).toBeNull()
  })
})
