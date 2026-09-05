/**
 * tests/integration/public-passport.test.ts
 * TESTE 03 (Etapa "F2 — Closed Beta Test Suite") — `get_public_passport`
 * contra Supabase DEV real. Contrato lido diretamente da migration real
 * (`20260902160000_coin_images_governance_foundation.sql`, versão vigente
 * da função) — nenhum campo assumido.
 *
 * Chamado sem sessão (client anônimo) — é assim que a página pública
 * `/passport/[username]` de fato consulta a RPC (SECURITY DEFINER,
 * callable por `anon`).
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

// Exatamente os campos que `PublicPassportCoin` (features/passport/types.ts)
// declara — espelha o contrato real da RPC. Preço, custo, vendedor e
// qualquer dado financeiro/pessoal NUNCA devem aparecer aqui.
const EXPECTED_COIN_KEYS = [
  'countryCode',
  'countryName',
  'countryFlagEmoji',
  'year',
  'denomination',
  'metalName',
  'secondaryMetalName',
  'quantity',
  'photoStoragePath',
  'labelCode',
].sort()

describe.skipIf(!hasTestEnv())('get_public_passport RPC', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let anon: SupabaseClient
  let user: DisposableUser
  let client: SupabaseClient
  let username: string
  let itemId: string

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    anon = createAnonClient(env)
    user = await createDisposableUser(admin, 'passport')
    client = await signInAsDisposableUser(env, user)
    username = `passporttest${Date.now()}`

    const { error: profileError } = await client
      .from('profiles')
      .update({ username, passport_public: true })
      .eq('id', user.id)
    if (profileError) throw new Error(`[public-passport.test] setup de perfil falhou: ${profileError.message}`)

    const { data: item, error: itemError } = await client
      .from('collection_items')
      .insert({ user_id: user.id, country_code: 'BR', year: 1980, denomination: 'Teste Passport', metal_code: 'CU' })
      .select('id')
      .single()
    if (itemError || !item) throw new Error(`[public-passport.test] setup de item falhou: ${itemError?.message}`)
    itemId = item.id as string
  })

  afterAll(async () => {
    await deleteDisposableUser(admin, user.id)
  })

  async function setVisibility(mode: 'none' | 'all' | 'selected') {
    const { error } = await client.from('profiles').update({ passport_collection_visibility: mode }).eq('id', user.id)
    if (error) throw new Error(`[public-passport.test] setVisibility falhou: ${error.message}`)
  }

  async function setItemPublic(value: boolean) {
    const { error } = await client.from('collection_items').update({ is_public: value }).eq('id', itemId)
    if (error) throw new Error(`[public-passport.test] setItemPublic falhou: ${error.message}`)
  }

  it('visibility = "none": coins vazio, mas os agregados continuam refletindo a coleção real', async () => {
    await setVisibility('none')
    const { data, error } = await anon.rpc('get_public_passport', { p_username: username })
    expect(error).toBeNull()
    expect(data.coins).toEqual([])
    expect(data.totalCoins).toBe(1)
    expect(data.collectionVisibility).toBe('none')
  })

  it('visibility = "all": a moeda aparece, com exatamente os campos do contrato público (sem dado financeiro/pessoal)', async () => {
    await setVisibility('all')
    const { data, error } = await anon.rpc('get_public_passport', { p_username: username })
    expect(error).toBeNull()
    expect(data.coins).toHaveLength(1)
    const coin = data.coins[0]
    expect(Object.keys(coin).sort()).toEqual(EXPECTED_COIN_KEYS)
    expect(coin.denomination).toBe('Teste Passport')
    expect(coin.countryCode).toBe('BR')
    expect(coin.year).toBe(1980)
    expect(coin.photoStoragePath).toBeNull()
    expect(coin.labelCode).toBeNull()
  })

  it('F5 — B) labelCode não aparece (vem null) enquanto collection_items.label_code é NULL', async () => {
    // Item recém-criado no `beforeAll`, nunca teve etiqueta gerada — estado
    // inicial real de qualquer moeda antes da primeira geração de etiqueta.
    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data.coins[0].labelCode).toBeNull()
  })

  it('F5 — A) labelCode aparece quando collection_items.label_code já está definido (RPC só lê, nunca gera)', async () => {
    // `label_code` está fora do GRANT UPDATE de `authenticated` de propósito
    // (só `ensure_label_codes()`, SECURITY DEFINER, escreve nela — ver
    // `20260905090000_create_label_codes.sql`) — por isso o setup deste
    // teste usa `admin` (service_role), nunca o client autenticado comum.
    // `label_code` também é IMUTÁVEL uma vez definido (trigger
    // `protect_label_code`) — este teste nunca o reseta de volta para null.
    const { error } = await admin.from('collection_items').update({ label_code: 'NMR-0000123' }).eq('id', itemId)
    if (error) throw new Error(`[public-passport.test] setLabelCode falhou: ${error.message}`)

    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data.coins[0].labelCode).toBe('NMR-0000123')
  })

  it('visibility = "selected" com item privado (is_public=false): coins vazio', async () => {
    await setVisibility('selected')
    await setItemPublic(false)
    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data.coins).toEqual([])
  })

  it('visibility = "selected" com item público (is_public=true): a moeda aparece', async () => {
    await setItemPublic(true)
    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data.coins).toHaveLength(1)
  })

  it('nunca expõe preço de compra, custo, e-mail ou qualquer dado pessoal/privado em nenhum nível do payload', async () => {
    await setVisibility('all')
    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    const serialized = JSON.stringify(data).toLowerCase()
    for (const forbidden of ['price', 'total_price', 'unit_cost', 'preco', 'preço', 'custo', 'email', 'seller']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('F5 — E) labelCode não abre um novo vetor de exposição: purchase_id, localização e notas privadas continuam ausentes mesmo quando preenchidas na linha', async () => {
    // `location`/`description` também estão fora do GRANT UPDATE de
    // `authenticated` — setup via `admin` (service_role), só para este teste.
    const { error } = await admin
      .from('collection_items')
      .update({ location: 'Cofre em casa, gaveta 3', description: 'Nota pessoal privada' })
      .eq('id', itemId)
    if (error) throw new Error(`[public-passport.test] setup de campos privados falhou: ${error.message}`)

    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    // labelCode já foi definido pelo teste "F5 — A" acima e é imutável — continua presente aqui.
    expect(data.coins[0].labelCode).toBe('NMR-0000123')

    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('Cofre em casa')
    expect(serialized).not.toContain('Nota pessoal privada')
    expect(serialized).not.toContain(itemId)
    expect(Object.keys(data.coins[0])).not.toContain('id')
    expect(Object.keys(data.coins[0])).not.toContain('purchaseId')

    await admin.from('collection_items').update({ location: null, description: null }).eq('id', itemId)
  })

  it('F5 — C) Passport privado (passport_public = false) devolve null, mesmo com o username existindo de fato', async () => {
    const { error } = await client.from('profiles').update({ passport_public: false }).eq('id', user.id)
    if (error) throw new Error(`[public-passport.test] setPassportPublic(false) falhou: ${error.message}`)

    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data).toBeNull()

    await client.from('profiles').update({ passport_public: true }).eq('id', user.id)
  })

  it('photoStoragePath: null quando photo_public = false, mesmo com is_public = true', async () => {
    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data.coins[0].photoStoragePath).toBeNull()
  })

  it('photoStoragePath: preenchido só quando photo_public = true E existe foto "front" cadastrada no exemplar principal', async () => {
    const { data: unit, error: unitError } = await client
      .from('collection_units')
      .insert({ collection_item_id: itemId, is_primary: true })
      .select('id')
      .single()
    if (unitError || !unit) throw new Error(`setup de unit falhou: ${unitError?.message}`)

    const storagePath = `${user.id}/${unit.id}/front.webp`
    const { error: imageError } = await client.from('coin_images').insert({
      collection_unit_id: unit.id,
      kind: 'front',
      storage_path: storagePath,
      width: 800,
      height: 800,
      file_size: 12_345,
    })
    if (imageError) throw new Error(`setup de coin_images falhou: ${imageError.message}`)

    const { error: photoPublicError } = await client
      .from('collection_items')
      .update({ photo_public: true })
      .eq('id', itemId)
    if (photoPublicError) throw new Error(`setPhotoPublic falhou: ${photoPublicError.message}`)

    const { data } = await anon.rpc('get_public_passport', { p_username: username })
    expect(data.coins[0].photoStoragePath).toBe(storagePath)
  })

  it('username inexistente ou Passport privado devolve null (a RPC nunca diferencia os dois motivos)', async () => {
    const { data } = await anon.rpc('get_public_passport', { p_username: 'usuario-que-nao-existe-999' })
    expect(data).toBeNull()
  })
})
