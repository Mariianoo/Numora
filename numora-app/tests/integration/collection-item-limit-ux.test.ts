/**
 * tests/integration/collection-item-limit-ux.test.ts
 * Etapa "5.9D — Paywall UX" — prova contra Supabase DEV real que:
 *
 * 1) o contrato de campos de `check_collection_item_limit()` (snake_case)
 *    é exatamente o que `CollectionRepository.getItemLimit()` espera
 *    mapear (rede de segurança contra deriva de schema — testado com
 *    mocks em tests/unit/collection-item-limit-ux.test.ts, mas só um
 *    teste contra o banco real prova que os nomes das colunas continuam
 *    batendo);
 * 2) o erro real que a RLS/trigger produzem ao bloquear um INSERT/UPDATE
 *    por causa do limite é corretamente reconhecido por `isPermissionError()`
 *    — a peça que decide "isto vira Paywall" na tela de Coleção/Lixeira.
 *
 * O enforcement em si (concorrência, grandfathering, courtesy, ciclo de
 * assinatura) já foi exaustivamente provado em
 * tests/integration/collection-item-limit.test.ts (Etapa 5.9B) — não
 * duplicado aqui.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { isPermissionError } from '@/lib/errors/get-user-friendly-error-message'
import { createAdminClient, createDisposableUser, deleteDisposableUser, getTestEnv, hasTestEnv, signInAsDisposableUser, type DisposableUser, type TestEnv } from '../support/dev-env'

describe.skipIf(!hasTestEnv())('Camada de aplicação do Paywall (DEV real) — Etapa 5.9D', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let user: DisposableUser
  let client: SupabaseClient

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'limit-ux')
    client = await signInAsDisposableUser(env, user)
  })

  afterAll(async () => {
    await admin.from('collection_items').delete().eq('user_id', user.id)
    await deleteDisposableUser(admin, user.id)
  })

  it('check_collection_item_limit() devolve exatamente os campos que getItemLimit() espera mapear', async () => {
    const { data, error } = await client.rpc('check_collection_item_limit').maybeSingle()
    expect(error).toBeNull()

    const row = data as Record<string, unknown>
    expect(row).toHaveProperty('allowed')
    expect(row).toHaveProperty('current_count')
    expect(row).toHaveProperty('limit')
    expect(row).toHaveProperty('plan_slug')
    expect(row).toHaveProperty('is_unlimited')
    expect(typeof row.allowed).toBe('boolean')
    expect(typeof row.current_count).toBe('number')
    expect(typeof row.plan_slug).toBe('string')
    expect(typeof row.is_unlimited).toBe('boolean')
  })

  it('o erro real de INSERT bloqueado pelo limite é reconhecido por isPermissionError() — a peça que decide o Paywall', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ user_id: user.id, country_code: 'BR', year: 2000 + (i % 20), denomination: `5.9D ux ${i}` }))
    const { error: seedError } = await admin.from('collection_items').insert(rows)
    expect(seedError).toBeNull()

    const { error: insertError } = await client.from('collection_items').insert({ user_id: user.id, country_code: 'BR', year: 2022, denomination: '51ª tentativa' })

    expect(insertError).not.toBeNull()
    expect(isPermissionError(insertError)).toBe(true)
  })

  it('o erro real de RESTORE bloqueado pelo trigger (RAISE EXCEPTION customizado) também é reconhecido por isPermissionError()', async () => {
    // Estado atual: 50 ativos (do teste anterior). Um item na lixeira não pode ser restaurado.
    const { data: trashed, error: seedError } = await admin
      .from('collection_items')
      .insert({ user_id: user.id, country_code: 'BR', year: 1999, denomination: '5.9D ux trashed', deleted_at: new Date().toISOString() })
      .select('id')
      .single()
    expect(seedError).toBeNull()

    const { error: restoreError } = await client.from('collection_items').update({ deleted_at: null }).eq('id', trashed!.id)

    expect(restoreError).not.toBeNull()
    // Esta é a asserção central: a mensagem do RAISE EXCEPTION do trigger
    // NUNCA contém "row-level security" (é customizada) — só o CÓDIGO
    // 42501 permite reconhecer isto como bloqueio de permissão.
    expect(restoreError?.code).toBe('42501')
    expect(isPermissionError(restoreError)).toBe(true)
  })
})
