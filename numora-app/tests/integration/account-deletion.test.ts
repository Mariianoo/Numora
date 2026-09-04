/**
 * tests/integration/account-deletion.test.ts
 * TESTE 05 (Etapa "F2 — Closed Beta Test Suite") — DESTRUTIVO, só roda
 * contra DEV (guard de `tests/support/dev-env.ts`). Reproduz, na mesma
 * ordem, a sequência real de `app/api/account/delete/route.ts` (o único
 * consumidor de `service_role` do app): banir → limpar Storage nos 2
 * buckets → RPC `delete_own_account_data` → `auth.admin.deleteUser`.
 *
 * Não importa o Route Handler diretamente (precisaria de sessão HTTP real
 * via servidor Next rodando) — chama a mesma sequência de operações
 * Supabase Admin, na mesma ordem, permitindo asserção fina por tabela
 * (algo que o E2E do fluxo real via UI, em tests/e2e/account-deletion.spec.ts,
 * não consegue fazer). As duas abordagens se complementam: este teste
 * verifica CADA tabela; o E2E prova que o código de produção real (a rota
 * em si) funciona ponta a ponta.
 *
 * ESCOPO: cobre profiles, collection_items, collection_units, coin_images,
 * purchases, user_acquisition e Storage (2 buckets) — as tabelas que este
 * teste consegue popular com uma configuração realista em tempo razoável.
 * `sales`/`billing_*` NÃO são exercitadas aqui (nenhum fluxo já usado
 * nesta suíte cria uma venda ou assinatura) — a cobertura delas é a
 * auditoria de FK/cascade já feita ao criar `delete_own_account_data`
 * (ver comentário da migration `create_delete_own_account_data_rpc.sql`,
 * que lista essas tabelas explicitamente), não uma linha real testada
 * aqui. Registrado como limitação conhecida no relatório desta etapa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient, createDisposableUser, getTestEnv, hasTestEnv, signInAsDisposableUser, type DisposableUser, type TestEnv } from '../support/dev-env'

const PRIVATE_BUCKET = 'coin-images'
const PUBLIC_BUCKET = 'coin-images-public'
const BAN_DURATION = '876000h'

describe.skipIf(!hasTestEnv())('Exclusão de conta — fluxo completo (destrutivo, DEV apenas)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let user: DisposableUser
  let client: SupabaseClient
  let itemId: string
  let unitId: string
  let purchaseId: string
  let userDeleted = false

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'deletion')
    client = await signInAsDisposableUser(env, user)

    const { data: purchase, error: purchaseError } = await client
      .from('purchases')
      .insert({ user_id: user.id, total_price: 42.5, seller_name: 'Vendedor Teste' })
      .select('id')
      .single()
    if (purchaseError || !purchase) throw new Error(`setup de purchase falhou: ${purchaseError?.message}`)
    purchaseId = purchase.id as string

    const { data: item, error: itemError } = await client
      .from('collection_items')
      .insert({ user_id: user.id, denomination: 'Teste Exclusão', purchase_id: purchaseId })
      .select('id')
      .single()
    if (itemError || !item) throw new Error(`setup de item falhou: ${itemError?.message}`)
    itemId = item.id as string

    const { data: unit, error: unitError } = await client
      .from('collection_units')
      .insert({ collection_item_id: itemId, is_primary: true, purchase_id: purchaseId, cost_type: 'purchase', unit_cost: 42.5 })
      .select('id')
      .single()
    if (unitError || !unit) throw new Error(`setup de unit falhou: ${unitError?.message}`)
    unitId = unit.id as string

    const { error: imageError } = await client.from('coin_images').insert({
      collection_unit_id: unitId,
      kind: 'front',
      storage_path: `${user.id}/${unitId}/front.webp`,
      width: 400,
      height: 400,
      file_size: 1000,
    })
    if (imageError) throw new Error(`setup de coin_images falhou: ${imageError.message}`)

    const { error: acquisitionError } = await client
      .from('user_acquisition')
      .insert({ user_id: user.id, first_source: 'teste', landing_path: '/' })
    if (acquisitionError) throw new Error(`setup de user_acquisition falhou: ${acquisitionError.message}`)

    const { error: privateUploadError } = await client.storage
      .from(PRIVATE_BUCKET)
      .upload(`${user.id}/${unitId}/front.webp`, 'bytes-privados-de-teste', { contentType: 'text/plain' })
    if (privateUploadError) throw new Error(`setup de Storage privado falhou: ${privateUploadError.message}`)

    const { error: publicUploadError } = await client.storage
      .from(PUBLIC_BUCKET)
      .upload(`${user.id}/${unitId}/front.webp`, 'bytes-publicos-de-teste', { contentType: 'text/plain' })
    if (publicUploadError) throw new Error(`setup de Storage público falhou: ${publicUploadError.message}`)
  })

  // Rede de segurança: se algum teste falhar ANTES da exclusão de fato
  // acontecer, ainda assim remove o usuário descartável ao final.
  afterAll(async () => {
    if (!userDeleted) {
      await admin.auth.admin.deleteUser(user.id).catch(() => {})
    }
  })

  it('estado inicial: os dados de teste existem de fato antes da exclusão', async () => {
    const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle()
    const { data: item } = await admin.from('collection_items').select('id').eq('id', itemId).maybeSingle()
    expect(profile?.id).toBe(user.id)
    expect(item?.id).toBe(itemId)
  })

  it('executa a sequência real de exclusão: ban → Storage (2 buckets) → RPC → deleteUser', async () => {
    const { error: banError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: BAN_DURATION })
    expect(banError).toBeNull()

    const { error: removePrivateError } = await admin.storage
      .from(PRIVATE_BUCKET)
      .remove([`${user.id}/${unitId}/front.webp`])
    expect(removePrivateError).toBeNull()

    const { error: removePublicError } = await admin.storage
      .from(PUBLIC_BUCKET)
      .remove([`${user.id}/${unitId}/front.webp`])
    expect(removePublicError).toBeNull()

    const { error: rpcError } = await admin.rpc('delete_own_account_data', { p_user_id: user.id })
    expect(rpcError).toBeNull()

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id)
    expect(deleteUserError).toBeNull()
    userDeleted = true
  })

  it('auth.users removido', async () => {
    const { data, error } = await admin.auth.admin.getUserById(user.id)
    expect(data.user).toBeNull()
    expect(error).not.toBeNull()
  })

  it('profile removido', async () => {
    const { data } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle()
    expect(data).toBeNull()
  })

  it('collection_items removidos (cascade a partir de profiles)', async () => {
    const { data } = await admin.from('collection_items').select('id').eq('id', itemId).maybeSingle()
    expect(data).toBeNull()
  })

  it('collection_units removidas (cascade a partir de collection_items)', async () => {
    const { data } = await admin.from('collection_units').select('id').eq('id', unitId).maybeSingle()
    expect(data).toBeNull()
  })

  it('coin_images removidas (cascade a partir de collection_units)', async () => {
    const { data } = await admin.from('coin_images').select('id').eq('collection_unit_id', unitId).maybeSingle()
    expect(data).toBeNull()
  })

  it('purchases removidas (dados financeiros associados)', async () => {
    const { data } = await admin.from('purchases').select('id').eq('id', purchaseId).maybeSingle()
    expect(data).toBeNull()
  })

  it('user_acquisition removida', async () => {
    const { data } = await admin.from('user_acquisition').select('id').eq('user_id', user.id).maybeSingle()
    expect(data).toBeNull()
  })

  it('objetos de Storage removidos nos dois buckets', async () => {
    const { data: privateFiles } = await admin.storage.from(PRIVATE_BUCKET).list(user.id)
    const { data: publicFiles } = await admin.storage.from(PUBLIC_BUCKET).list(user.id)
    expect(privateFiles ?? []).toEqual([])
    expect(publicFiles ?? []).toEqual([])
  })
})
