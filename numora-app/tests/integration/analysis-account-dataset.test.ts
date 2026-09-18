/**
 * tests/integration/analysis-account-dataset.test.ts
 * Etapa "5.10W.3 — Conta de Análise: dataset fictício". TESTE DE
 * SEGURANÇA — mesmo espírito de
 * tests/integration/analysis-account-plan-switch.test.ts: roda contra
 * Supabase DEV real com sessões reais (nunca `service_role` para exercer
 * os caminhos testados — só para setup/cleanup e para promover
 * admin/owner).
 *
 * Cobre: `populate_analysis_account_dataset()`/`reset_analysis_account_dataset()`
 * exclusivos de owner, nunca aceitam `user_id` arbitrário (revalidam
 * `internal_test_accounts` internamente), população é idempotente, reset
 * remove SOMENTE o dataset (nunca `internal_test_accounts`/`benefit_grants`/
 * usuários reais), e o dataset é dimensionado/variado o suficiente para
 * exercitar países/anos/metais/compras/export model, sem ultrapassar o
 * limite Free.
 *
 * Etapa "5.10W.4": também cobre `get_analysis_account_dataset_summary()`
 * (RPC nova, só leitura, criada para a UI administrativa) — admin OU
 * owner conseguem ler (mais permissiva que as RPCs de escrita, de
 * propósito), usuário comum não consegue, `user_id` real é rejeitado.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
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

describe.skipIf(!hasTestEnv())('populate/reset_analysis_account_dataset — Conta de Análise (5.10W.3)', () => {
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

    analysisAccount = await createDisposableUser(admin, 'dataset-analysis-account')
    realUser = await createDisposableUser(admin, 'dataset-real-user')
    ownerUser = await createDisposableUser(admin, 'dataset-owner')
    adminOnlyUser = await createDisposableUser(admin, 'dataset-admin-only')

    await admin.from('profiles').update({ role: 'owner' }).eq('id', ownerUser.id)
    await admin.from('profiles').update({ role: 'admin' }).eq('id', adminOnlyUser.id)

    const { error: markError } = await admin
      .from('internal_test_accounts')
      .insert({ user_id: analysisAccount.id, created_by: ownerUser.id })
    if (markError) throw new Error(`[analysis-account-dataset.test] Falha ao marcar Conta de Análise: ${markError.message}`)

    clientOwner = await signInAsDisposableUser(env, ownerUser)
    clientAdminOnly = await signInAsDisposableUser(env, adminOnlyUser)
    clientRealUser = await signInAsDisposableUser(env, realUser)
  })

  afterAll(async () => {
    // Reset final do dataset (idempotente mesmo se já estiver vazio) antes
    // de excluir os usuários descartáveis.
    await clientOwner.rpc('reset_analysis_account_dataset', { p_user_id: analysisAccount.id })
    await admin.from('internal_test_accounts').delete().eq('user_id', analysisAccount.id)
    await admin.from('collection_items').delete().eq('user_id', realUser.id)
    await deleteDisposableUser(admin, analysisAccount.id)
    await deleteDisposableUser(admin, realUser.id)

    await admin.from('profiles').update({ role: 'user' }).eq('id', ownerUser.id)
    await deleteDisposableUser(admin, ownerUser.id)
    await deleteDisposableUser(admin, adminOnlyUser.id)
  })

  interface PopulateResult {
    populated: boolean
    item_count: number
  }

  /** Tipagem local do retorno da RPC (sem tipos gerados para esta função nova) — mesmo padrão já usado em outras suítes desta base de código (ex.: cast de `get_my_entitlement`). */
  async function callPopulate(client: SupabaseClient, userId: string): Promise<{ data: PopulateResult | null; error: { message: string } | null }> {
    const result = await client.rpc('populate_analysis_account_dataset', { p_user_id: userId }).single()
    return { data: result.data as PopulateResult | null, error: result.error }
  }

  async function itemsOf(userId: string) {
    const { data, error } = await admin
      .from('collection_items')
      .select('id, country_code, year, metal_code, secondary_metal_code, purity, gross_weight_g, face_value, mintage, purchase_id, label_code, denomination, description, location, tags, history, trivia, catalog_references')
      .eq('user_id', userId)
    if (error) throw new Error(error.message)
    return data ?? []
  }

  it('1. Owner consegue popular o dataset da Conta de Análise', async () => {
    const { data, error } = await callPopulate(clientOwner, analysisAccount.id)
    expect(error).toBeNull()
    expect(data?.populated).toBe(true)
    expect(data?.item_count).toBe(35)
  })

  it('6. Populate cria dataset real (collection_items de verdade, dentro do limite Free < 50)', async () => {
    const items = await itemsOf(analysisAccount.id)
    expect(items).toHaveLength(35)
    expect(items.length).toBeLessThan(50)
  })

  it('15. Dataset possui variedade de países (≥ 10 códigos distintos)', async () => {
    const items = await itemsOf(analysisAccount.id)
    const distinctCountries = new Set(items.map((i) => i.country_code))
    expect(distinctCountries.size).toBeGreaterThanOrEqual(10)
  })

  it('16. Dataset possui variedade de anos/décadas', async () => {
    const items = await itemsOf(analysisAccount.id)
    const decades = new Set(items.map((i) => Math.floor((i.year as number) / 10) * 10))
    expect(decades.size).toBeGreaterThanOrEqual(5)
  })

  it('17. Dataset possui variedade de metais (metal principal e alguns com metal secundário/bimetálicos)', async () => {
    const items = await itemsOf(analysisAccount.id)
    const distinctMetals = new Set(items.map((i) => i.metal_code))
    expect(distinctMetals.size).toBeGreaterThanOrEqual(5)

    const withSecondary = items.filter((i) => i.secondary_metal_code !== null)
    expect(withSecondary.length).toBeGreaterThan(0)

    const withKnownPurity = items.filter((i) => i.purity !== null)
    const withUnknownPurity = items.filter((i) => i.purity === null)
    expect(withKnownPurity.length).toBeGreaterThan(0)
    expect(withUnknownPurity.length).toBeGreaterThan(0)
  })

  it('18. Dataset possui dados de compra (alguns itens com purchase_id, alguns sem)', async () => {
    const items = await itemsOf(analysisAccount.id)
    const withPurchase = items.filter((i) => i.purchase_id !== null)
    const withoutPurchase = items.filter((i) => i.purchase_id === null)
    expect(withPurchase.length).toBeGreaterThan(0)
    expect(withoutPurchase.length).toBeGreaterThan(0)

    const { data: purchases, error } = await admin.from('purchases').select('id, seller_name, purchase_date, total_price, notes').eq('user_id', analysisAccount.id)
    expect(error).toBeNull()
    expect(purchases!.length).toBe(withPurchase.length)
    for (const purchase of purchases!) {
      expect(purchase.seller_name).toBeTruthy()
      expect(purchase.total_price).toBeGreaterThan(0)
    }
  })

  it('19. Dataset possui dados suficientes para o export model (todos os campos usados por CollectionExportRow presentes em pelo menos alguns itens)', async () => {
    const items = await itemsOf(analysisAccount.id)

    expect(items.some((i) => i.denomination !== null)).toBe(true)
    expect(items.some((i) => i.mintage !== null)).toBe(true)
    expect(items.some((i) => i.description !== null)).toBe(true)
    expect(items.some((i) => i.location !== null)).toBe(true)
    expect(items.some((i) => Array.isArray(i.tags) && i.tags.length > 0)).toBe(true)
    expect(items.some((i) => i.history !== null)).toBe(true)
    expect(items.some((i) => i.trivia !== null)).toBe(true)
    expect(items.some((i) => Array.isArray(i.catalog_references) && i.catalog_references.length > 0)).toBe(true)
    expect(items.some((i) => i.label_code !== null)).toBe(true)
    expect(items.some((i) => i.label_code === null)).toBe(true)

    // Exemplares (grade/status/rating) e composição real (collection_item_coin_parts).
    const { data: units } = await admin.from('collection_units').select('id, grade_id, status, rating, collection_item_id').in(
      'collection_item_id',
      items.map((i) => i.id),
    )
    expect(units!.length).toBeGreaterThanOrEqual(35)
    expect(units!.some((u) => u.grade_id !== null)).toBe(true)
    expect(new Set(units!.map((u) => u.status)).size).toBeGreaterThan(1)

    const { data: parts } = await admin.from('collection_item_coin_parts').select('id').in(
      'collection_item_id',
      items.map((i) => i.id),
    )
    expect(parts!.length).toBeGreaterThan(0)
  })

  // Correção de portabilidade (5.10W.4): grades resolvidas por (scale, code),
  // nunca por id fixo. As escalas/códigos abaixo são os literais do seed
  // (20260812090100_seed_reference_tables.sql), iguais em todo ambiente.
  const EXPECTED_GRADE_CODES_BR = ['SOF', 'REG', 'BC', 'MBC', 'SOB', 'FC']
  const EXPECTED_GRADE_CODES_SHELDON = ['G4', 'VF20', 'EF40', 'MS60', 'MS63', 'MS65']

  it('P1. Dataset mantém exatamente 35 itens, 15 países e 30 compras (números exatos, não só mínimos)', async () => {
    const items = await itemsOf(analysisAccount.id)
    expect(items).toHaveLength(35)
    expect(new Set(items.map((i) => i.country_code)).size).toBe(15)

    const { data: purchases, error } = await admin.from('purchases').select('id').eq('user_id', analysisAccount.id)
    expect(error).toBeNull()
    expect(purchases).toHaveLength(30)
  })

  it('P2. Todas as grades usadas existem em public.grades e cada item recebe a grade esperada, identificada por (scale, code)', async () => {
    const items = await itemsOf(analysisAccount.id)
    const { data: units, error } = await admin
      .from('collection_units')
      .select('collection_item_id, grade_id, grades(scale, code)')
      .in(
        'collection_item_id',
        items.map((i) => i.id),
      )
      .eq('is_primary', true)
    expect(error).toBeNull()
    expect(units).toHaveLength(35)

    const gradeByItemId = new Map<string, { scale: string; code: string } | null>()
    for (const unit of units!) {
      const grade = unit.grades as unknown as { scale: string; code: string } | null
      gradeByItemId.set(unit.collection_item_id as string, grade)
    }

    const usedPairs = new Set<string>()
    for (const item of items) {
      const refs = item.catalog_references as Array<{ code: string }>
      const index = Number(refs[0].code.replace('D-', ''))
      const expected =
        index % 2 === 0
          ? { scale: 'br', code: EXPECTED_GRADE_CODES_BR[(index - 1) % EXPECTED_GRADE_CODES_BR.length] }
          : { scale: 'sheldon', code: EXPECTED_GRADE_CODES_SHELDON[(index - 1) % EXPECTED_GRADE_CODES_SHELDON.length] }

      const actual = gradeByItemId.get(item.id as string)
      expect(actual, `item D-${index} sem grade resolvida`).not.toBeNull()
      expect(actual).toEqual(expected)
      usedPairs.add(`${expected.scale}:${expected.code}`)
    }

    // Comportamento idêntico ao da versão original (6 grades distintas): a
    // paridade do índice seleciona a escala e `(i - 1) % 6` cai só em
    // posições ímpares para br (REG, MBC, FC) e pares para sheldon (G4,
    // EF40, MS63). As outras 6 do array são resolvidas/validadas, mas o
    // padrão determinístico existente nunca as atribui a um item.
    expect([...usedPairs].sort()).toEqual(['br:FC', 'br:MBC', 'br:REG', 'sheldon:EF40', 'sheldon:G4', 'sheldon:MS63'])
  })

  it('P3. Os 12 pares (scale, code) usados pelo dataset existem em public.grades neste banco', async () => {
    const { data, error } = await admin
      .from('grades')
      .select('scale, code')
      .or(`and(scale.eq.br,code.in.(${EXPECTED_GRADE_CODES_BR.join(',')})),and(scale.eq.sheldon,code.in.(${EXPECTED_GRADE_CODES_SHELDON.join(',')}))`)
    expect(error).toBeNull()
    expect(data).toHaveLength(12)
  })

  it('7. Populate novamente NÃO duplica (idempotente)', async () => {
    const { data, error } = await callPopulate(clientOwner, analysisAccount.id)
    expect(error).toBeNull()
    expect(data?.populated).toBe(false)
    expect(data?.item_count).toBe(35)

    const items = await itemsOf(analysisAccount.id)
    expect(items).toHaveLength(35)
  })

  it('3. Admin comum (NÃO owner) não consegue popular nem resetar', async () => {
    const populate = await clientAdminOnly.rpc('populate_analysis_account_dataset', { p_user_id: analysisAccount.id })
    expect(populate.error).not.toBeNull()

    const reset = await clientAdminOnly.rpc('reset_analysis_account_dataset', { p_user_id: analysisAccount.id })
    expect(reset.error).not.toBeNull()

    // Dataset permanece intacto apesar das tentativas.
    const items = await itemsOf(analysisAccount.id)
    expect(items).toHaveLength(35)
  })

  it('4. Usuário comum não consegue popular nem resetar', async () => {
    const populate = await clientRealUser.rpc('populate_analysis_account_dataset', { p_user_id: analysisAccount.id })
    expect(populate.error).not.toBeNull()

    const reset = await clientRealUser.rpc('reset_analysis_account_dataset', { p_user_id: analysisAccount.id })
    expect(reset.error).not.toBeNull()
  })

  it('5. user_id de um usuário REAL não pode ser alvo de populate/reset, mesmo pelo owner', async () => {
    const populate = await clientOwner.rpc('populate_analysis_account_dataset', { p_user_id: realUser.id })
    expect(populate.error).not.toBeNull()

    const reset = await clientOwner.rpc('reset_analysis_account_dataset', { p_user_id: realUser.id })
    expect(reset.error).not.toBeNull()

    const realUserItems = await itemsOf(realUser.id)
    expect(realUserItems).toEqual([])
  })

  it('20/21/22. Troca de plano (Pro → Premium → Free) NÃO altera a quantidade de itens do dataset', async () => {
    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'pro' })
    expect(await itemsOf(analysisAccount.id)).toHaveLength(35)

    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'premium' })
    expect(await itemsOf(analysisAccount.id)).toHaveLength(35)

    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'free' })
    expect(await itemsOf(analysisAccount.id)).toHaveLength(35)
  })

  it('11. Reset NÃO remove benefit_grants (grant internal_test ativo antes do reset continua depois)', async () => {
    await clientOwner.rpc('switch_analysis_account_plan', { p_user_id: analysisAccount.id, p_plan: 'pro' })

    const { data: before } = await admin.from('benefit_grants').select('id').eq('user_id', analysisAccount.id).eq('type', 'internal_test').is('revoked_at', null)
    expect(before!.length).toBe(1)

    await clientOwner.rpc('reset_analysis_account_dataset', { p_user_id: analysisAccount.id })

    const { data: after } = await admin.from('benefit_grants').select('id').eq('user_id', analysisAccount.id).eq('type', 'internal_test').is('revoked_at', null)
    expect(after).toEqual(before)
  })

  it('8/10. Reset remove o dataset mas preserva internal_test_accounts', async () => {
    // (reset já executado no teste anterior — confirma o resultado aqui)
    expect(await itemsOf(analysisAccount.id)).toEqual([])

    const { data: purchases } = await admin.from('purchases').select('id').eq('user_id', analysisAccount.id)
    expect(purchases).toEqual([])

    const { data: marker } = await admin.from('internal_test_accounts').select('user_id').eq('user_id', analysisAccount.id)
    expect(marker).toHaveLength(1)
  })

  it('9. Reset novamente (dataset já vazio) continua seguro/idempotente — nenhum erro', async () => {
    const { error } = await clientOwner.rpc('reset_analysis_account_dataset', { p_user_id: analysisAccount.id })
    expect(error).toBeNull()
    expect(await itemsOf(analysisAccount.id)).toEqual([])
  })

  it('13. Populate após reset recria o dataset determinístico (mesma contagem/estrutura)', async () => {
    const { data, error } = await callPopulate(clientOwner, analysisAccount.id)
    expect(error).toBeNull()
    expect(data?.populated).toBe(true)
    expect(data?.item_count).toBe(35)

    const items = await itemsOf(analysisAccount.id)
    expect(items).toHaveLength(35)
    // Mesma variedade de países que a primeira população (determinístico).
    expect(new Set(items.map((i) => i.country_code)).size).toBeGreaterThanOrEqual(10)
  })

  it('12. Reset da Conta de Análise NÃO afeta a coleção de um usuário real', async () => {
    const { data: realItem, error: insertError } = await clientRealUser
      .from('collection_items')
      .insert({ user_id: realUser.id, country_code: 'BR', year: 2020, denomination: 'Item real de teste' })
      .select('id')
      .single()
    expect(insertError).toBeNull()

    await clientOwner.rpc('reset_analysis_account_dataset', { p_user_id: analysisAccount.id })

    const { data: stillThere, error: readError } = await admin.from('collection_items').select('id').eq('id', realItem!.id)
    expect(readError).toBeNull()
    expect(stillThere).toHaveLength(1)
  })

  describe('get_analysis_account_dataset_summary — RPC de leitura (5.10W.4)', () => {
    it('owner consegue ler o resumo do dataset', async () => {
      const { data, error } = await clientOwner
        .rpc('get_analysis_account_dataset_summary', { p_user_id: analysisAccount.id })
        .maybeSingle()
      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(typeof (data as { item_count: number }).item_count).toBe('number')
    })

    it('admin comum (NÃO owner) TAMBÉM consegue ler — mais permissiva que as RPCs de escrita, de propósito', async () => {
      const { data, error } = await clientAdminOnly
        .rpc('get_analysis_account_dataset_summary', { p_user_id: analysisAccount.id })
        .maybeSingle()
      expect(error).toBeNull()
      expect(data).not.toBeNull()
    })

    it('usuário comum NÃO consegue ler', async () => {
      const { data, error } = await clientRealUser
        .rpc('get_analysis_account_dataset_summary', { p_user_id: analysisAccount.id })
        .maybeSingle()
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })

    it('user_id de usuário REAL é rejeitado, mesmo pelo owner', async () => {
      const { data, error } = await clientOwner
        .rpc('get_analysis_account_dataset_summary', { p_user_id: realUser.id })
        .maybeSingle()
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })
  })
})

/**
 * Portabilidade da migration corretiva (5.10W.4) — inspeção estática dos
 * arquivos de migration, sem tocar em nenhum banco (nem Production). Não
 * depende de credenciais de teste, por isso fica fora do `skipIf`.
 *
 * `populate_analysis_account_dataset()` foi originalmente escrita com IDs
 * de `grades` fixos (não portáveis: `grades.id` é `gen_random_uuid()` e
 * difere entre bancos). A versão vigente é a da migration mais recente que
 * redefine a função, e ela precisa resolver grades por (scale, code).
 */
describe('populate_analysis_account_dataset — portabilidade (migration corretiva 5.10W.4)', () => {
  const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')
  const UUID_LITERAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  function latestPopulateMigration(): { file: string; source: string } {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const defining = files.filter((f) =>
      /create or replace function public\.populate_analysis_account_dataset\(/i.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')),
    )
    const file = defining[defining.length - 1]
    return { file, source: readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }
  }

  it('a definição vigente da função vem de uma migration corretiva posterior à original', () => {
    const { file } = latestPopulateMigration()
    expect(file).not.toBe('20260915214448_create_populate_analysis_account_dataset_rpc.sql')
    expect(file).toMatch(/resolve_grades/)
  })

  it('nenhum UUID hardcoded permanece na definição vigente da função', () => {
    const { source } = latestPopulateMigration()
    expect(source).not.toMatch(UUID_LITERAL)
  })

  it('grades são resolvidas por (scale, code) em public.grades, com validação explícita antes de qualquer INSERT', () => {
    const { source } = latestPopulateMigration()
    expect(source).toMatch(/from public\.grades g where g\.scale = m\.scale and g\.code = m\.code/)
    expect(source).toMatch(/join public\.grades g on g\.scale = 'br' and g\.code = c\.code/)
    expect(source).toMatch(/join public\.grades g on g\.scale = 'sheldon' and g\.code = c\.code/)
    expect(source).toMatch(/raise exception 'Grades de referência ausentes/)

    // A validação acontece ANTES do primeiro INSERT da função (nenhum dataset parcial).
    const validationIndex = source.indexOf('Grades de referência ausentes')
    const firstInsertIndex = source.indexOf('insert into public.collection_items')
    expect(validationIndex).toBeGreaterThan(-1)
    expect(validationIndex).toBeLessThan(firstInsertIndex)
  })

  it('os códigos usados existem como literais no seed de grades (estáveis por construção, não por dado de um ambiente)', () => {
    const { source } = latestPopulateMigration()
    const brCodes = /v_grade_codes_br constant text\[\] := array\[([^\]]+)\]/.exec(source)![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))
    const sheldonCodes = /v_grade_codes_sheldon constant text\[\] := array\[([^\]]+)\]/.exec(source)![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))
    expect(brCodes).toEqual(['SOF', 'REG', 'BC', 'MBC', 'SOB', 'FC'])
    expect(sheldonCodes).toEqual(['G4', 'VF20', 'EF40', 'MS60', 'MS63', 'MS65'])

    const seed = readFileSync(path.join(MIGRATIONS_DIR, '20260812090100_seed_reference_tables.sql'), 'utf8')
    for (const code of brCodes) expect(seed).toMatch(new RegExp(`\\('br',\\s*'${code}'`))
    for (const code of sheldonCodes) expect(seed).toMatch(new RegExp(`\\('sheldon',\\s*'${code}'`))
  })

  it('segurança preservada: SECURITY DEFINER, search_path fixo, owner-only, marker obrigatório, sem SQL dinâmico, grants sem PUBLIC/anon', () => {
    const { source } = latestPopulateMigration()
    expect(source).toMatch(/security definer/i)
    expect(source).toMatch(/set search_path = public/i)
    expect(source).toMatch(/if not public\.is_platform_owner\(\)/)
    expect(source).toMatch(/from public\.internal_test_accounts where user_id = p_user_id/)
    expect(source).not.toMatch(/\bexecute\s+(format|')/i)
    expect(source).toMatch(/revoke execute on function public\.populate_analysis_account_dataset\(uuid\) from public, anon/)
    expect(source).toMatch(/grant execute on function public\.populate_analysis_account_dataset\(uuid\) to authenticated/)
    expect(source).not.toMatch(/service_role|password|secret/i)
  })
})
