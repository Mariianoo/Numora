/**
 * tests/integration/benefit-grants-expiration.test.ts
 * BUGFIX real — "conceder cortesia expirando hoje" violava
 * `chk_benefit_grants_expires_after_starts`. Causa: o formulário
 * (`GrantCourtesyModal.tsx`) convertia a data escolhida com
 * `new Date(dateOnly).toISOString()`, que a spec ECMA-262 interpreta como
 * MEIA-NOITE UTC do dia escolhido — sempre anterior a `starts_at` (default
 * `now()` no INSERT) para qualquer expiração "hoje", e potencialmente para
 * "amanhã" dependendo do fuso do navegador. Corrigido com
 * `endOfDayLocalISOString()` (lib/format/date.ts), que gera o instante do
 * FIM do dia local escolhido.
 *
 * Estes testes reproduzem o fluxo real via `service_role` (mesma inserção
 * que `AdminRepository.grantCourtesy` faz), simulando exatamente o que o
 * formulário envia após a correção — não testam a UI, só a regra de
 * negócio e a constraint no banco real de DEV.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { endOfDayLocalISOString } from '@/lib/format/date'
import {
  createAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'

function todayDateOnly(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function tomorrowDateOnly(): string {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
}

describe.skipIf(!hasTestEnv())('benefit_grants — expiração "hoje"/"amanhã" (bugfix chk_benefit_grants_expires_after_starts)', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let user: DisposableUser
  const grantIds: string[] = []

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    user = await createDisposableUser(admin, 'benefit-grants-expiration')
  })

  afterAll(async () => {
    if (grantIds.length > 0) {
      await admin.from('benefit_grants').delete().in('id', grantIds)
    }
    await deleteDisposableUser(admin, user.id)
  })

  it('1. expiração HOJE (endOfDayLocalISOString) é aceita — reproduz exatamente o bug relatado', async () => {
    const expiresAt = endOfDayLocalISOString(todayDateOnly())

    const { data, error } = await admin
      .from('benefit_grants')
      .insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste', expires_at: expiresAt })
      .select('id, starts_at, expires_at')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    grantIds.push(data!.id as string)

    expect(new Date(data!.expires_at as string).getTime()).toBeGreaterThan(new Date(data!.starts_at as string).getTime())
  })

  it('2. expiração AMANHÃ é aceita', async () => {
    const expiresAt = endOfDayLocalISOString(tomorrowDateOnly())

    const { data, error } = await admin
      .from('benefit_grants')
      .insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste', expires_at: expiresAt })
      .select('id, starts_at, expires_at')
      .single()

    expect(error).toBeNull()
    grantIds.push(data!.id as string)
    expect(new Date(data!.expires_at as string).getTime()).toBeGreaterThan(new Date(data!.starts_at as string).getTime())
  })

  it('3. expiração futura (30 dias) é aceita', async () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const dateOnly = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`
    const expiresAt = endOfDayLocalISOString(dateOnly)

    const { data, error } = await admin
      .from('benefit_grants')
      .insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste', expires_at: expiresAt })
      .select('id')
      .single()

    expect(error).toBeNull()
    grantIds.push(data!.id as string)
  })

  it('4. sem expiração (expires_at null) continua funcionando — cortesia sem prazo', async () => {
    const { data, error } = await admin
      .from('benefit_grants')
      .insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste', expires_at: null })
      .select('id, expires_at')
      .single()

    expect(error).toBeNull()
    expect(data!.expires_at).toBeNull()
    grantIds.push(data!.id as string)
  })

  it('5. data passada continua sendo rejeitada pela constraint (regra de negócio preservada)', async () => {
    const expiresAt = endOfDayLocalISOString('2020-01-01')

    const { data, error } = await admin
      .from('benefit_grants')
      .insert({ user_id: user.id, type: 'courtesy', plan: 'pro', reason: 'teste', expires_at: expiresAt })
      .select('id')
      .single()

    expect(error).not.toBeNull()
    expect(error!.message).toContain('chk_benefit_grants_expires_after_starts')
    expect(data).toBeNull()
  })

  it('6. get_effective_plan() reflete a cortesia com expiração hoje como plano ativo (source=courtesy)', async () => {
    const { data, error } = await admin.rpc('get_effective_plan', { p_user_id: user.id })
    expect(error).toBeNull()
    expect(data?.[0]?.plan_slug).toBe('pro')
    expect(data?.[0]?.source).toBe('courtesy')
  })
})
