/**
 * tests/integration/composition-rpc.test.ts
 * TESTE 02 (Etapa "F2 — Closed Beta Test Suite") — `set_collection_item_composition`
 * contra Supabase DEV real, com sessão real de usuário (nunca `service_role`
 * para exercer a RPC em si — só para setup/cleanup). Cobre as regras
 * documentadas na migration `20260902190000_set_collection_item_composition.sql`.
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

interface RpcCompositionPart {
  part: 'body' | 'core' | 'ring' | 'plating'
  components: { metalCode: string; percentage: number | null }[]
}

async function setComposition(client: SupabaseClient, itemId: string, parts: RpcCompositionPart[]) {
  return client.rpc('set_collection_item_composition', { p_collection_item_id: itemId, p_parts: parts })
}

describe.skipIf(!hasTestEnv())('set_collection_item_composition RPC', () => {
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
    userA = await createDisposableUser(admin, 'comp-a')
    userB = await createDisposableUser(admin, 'comp-b')
    clientA = await signInAsDisposableUser(env, userA)
    clientB = await signInAsDisposableUser(env, userB)

    const { data, error } = await clientA
      .from('collection_items')
      .insert({ user_id: userA.id, denomination: 'Teste Composição' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`[composition-rpc.test] setup falhou: ${error?.message}`)
    itemAId = data.id as string
  })

  afterAll(async () => {
    await deleteDisposableUser(admin, userA.id)
    await deleteDisposableUser(admin, userB.id)
  })

  it('composição simples válida (body, 1 componente, 100%) é aceita e deriva os campos legados', async () => {
    const { data, error } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'AG', percentage: 100 }] },
    ])
    expect(error).toBeNull()
    expect(data.parts).toHaveLength(1)
    expect(data.legacy.metalCode).toBe('AG')
    expect(data.legacy.purity).toBeCloseTo(1)
  })

  it('bimetálica válida (core + ring) é aceita', async () => {
    const { data, error } = await setComposition(clientA, itemAId, [
      { part: 'core', components: [{ metalCode: 'STEEL', percentage: 100 }] },
      { part: 'ring', components: [{ metalCode: 'BRASS', percentage: 100 }] },
    ])
    expect(error).toBeNull()
    expect(data.parts).toHaveLength(2)
    expect(data.legacy.metalCode).toBe('STEEL')
    expect(data.legacy.secondaryMetalCode).toBe('BRASS')
  })

  it('trimetálica válida (core + 2 rings) é aceita — RPC não limita quantidade de "ring"', async () => {
    const { data, error } = await setComposition(clientA, itemAId, [
      { part: 'core', components: [{ metalCode: 'CU', percentage: 100 }] },
      { part: 'ring', components: [{ metalCode: 'STEEL', percentage: 100 }] },
      { part: 'ring', components: [{ metalCode: 'BRASS', percentage: 100 }] },
    ])
    expect(error).toBeNull()
    expect(data.parts).toHaveLength(3)
    expect(data.parts.filter((p: { part: string }) => p.part === 'ring')).toHaveLength(2)
  })

  it('plating válido (body + plating) é aceito', async () => {
    const { data, error } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'STEEL', percentage: 100 }] },
      { part: 'plating', components: [{ metalCode: 'AU', percentage: 100 }] },
    ])
    expect(error).toBeNull()
    expect(data.parts).toHaveLength(2)
    // Caso 4 documentado: plating nunca participa da derivação legada.
    expect(data.legacy.metalCode).toBe('STEEL')
    expect(data.legacy.secondaryMetalCode).toBeNull()
  })

  it('percentual único diferente de 100 é rejeitado (22023)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'AG', percentage: 50 }] },
    ])
    expect(error?.code).toBe('22023')
  })

  it('soma de percentuais diferente de 100 é rejeitada (22023)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      {
        part: 'core',
        components: [
          { metalCode: 'CU', percentage: 60 },
          { metalCode: 'NI', percentage: 30 },
        ],
      },
      { part: 'ring', components: [{ metalCode: 'STEEL', percentage: 100 }] },
    ])
    expect(error?.code).toBe('22023')
  })

  it('percentual <= 0 é rejeitado (22023)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'AG', percentage: 0 }] },
    ])
    expect(error?.code).toBe('22023')
  })

  it('metal duplicado na mesma parte é rejeitado (23505)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      {
        part: 'body',
        components: [
          { metalCode: 'CU', percentage: 50 },
          { metalCode: 'CU', percentage: 50 },
        ],
      },
    ])
    expect(error?.code).toBe('23505')
  })

  it('metal inexistente no catálogo é rejeitado (23503)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'ZZZZ', percentage: 100 }] },
    ])
    expect(error?.code).toBe('23503')
  })

  it('estrutura inválida: "body" coexistindo com "core"/"ring" é rejeitada (22023)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'AG', percentage: 100 }] },
      { part: 'core', components: [{ metalCode: 'CU', percentage: 100 }] },
      { part: 'ring', components: [{ metalCode: 'NI', percentage: 100 }] },
    ])
    expect(error?.code).toBe('22023')
  })

  it('estrutura inválida: "core" sem "ring" é rejeitada (22023)', async () => {
    const { error } = await setComposition(clientA, itemAId, [
      { part: 'core', components: [{ metalCode: 'CU', percentage: 100 }] },
    ])
    expect(error?.code).toBe('22023')
  })

  it('usuário B tentando alterar composição do item de A é rejeitado (42501) e o estado de A é preservado', async () => {
    const before = await admin
      .from('collection_item_coin_parts')
      .select('id, part')
      .eq('collection_item_id', itemAId)

    const { error } = await setComposition(clientB, itemAId, [
      { part: 'body', components: [{ metalCode: 'AU', percentage: 100 }] },
    ])
    expect(error?.code).toBe('42501')

    const after = await admin.from('collection_item_coin_parts').select('id, part').eq('collection_item_id', itemAId)
    expect(after.data).toEqual(before.data)
  })

  it('após uma chamada rejeitada, a composição válida anterior permanece intacta (nunca "apaga, insere, desfaz")', async () => {
    const { error: setupError } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'PT', percentage: 100 }] },
    ])
    expect(setupError).toBeNull()

    const { error: rejectedError } = await setComposition(clientA, itemAId, [
      { part: 'body', components: [{ metalCode: 'ZZZZ', percentage: 100 }] },
    ])
    expect(rejectedError?.code).toBe('23503')

    const { data: current } = await admin
      .from('collection_item_coin_parts')
      .select('part, collection_item_coin_part_components ( metal_code, percentage )')
      .eq('collection_item_id', itemAId)
      .single()
    expect(current?.part).toBe('body')
    expect((current as unknown as { collection_item_coin_part_components: { metal_code: string }[] })
      .collection_item_coin_part_components[0].metal_code).toBe('PT')
  })
})
