/**
 * tests/integration/legal-consents.test.ts
 * TESTE DE SEGURANÇA (Etapa "B2 — Signup + Legal") — `legal_consents` e o
 * trigger `handle_new_user()` contra o Supabase DEV real (nunca Production —
 * ver tests/support/dev-env.ts). Chama a tabela DIRETO via PostgREST com
 * sessões reais, como um atacante faria; `service_role` só para setup,
 * limpeza e para provar que até ele não consegue UPDATE (trigger de
 * imutabilidade).
 *
 * Usuários são criados pela Admin API com `user_metadata` — o mesmo formato
 * que `supabase.auth.signUp({ options: { data } })` produz em
 * `raw_user_meta_data`, exatamente o que `handle_new_user()` lê.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { buildSignupConsents, recordSignupConsents } from '@/lib/legal/signup-consents'
import { AGE_CONFIRMATION_VERSION, MARKETING_OPT_IN_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'

import {
  createAdminClient,
  createAnonClient,
  deleteDisposableUser,
  getTestEnv,
  hasTestEnv,
  signInAsDisposableUser,
  type DisposableUser,
  type TestEnv,
} from '../support/dev-env'

let counter = 0

async function createUserWithMetadata(admin: SupabaseClient, label: string, metadata?: Record<string, unknown>): Promise<DisposableUser> {
  counter += 1
  const email = `numora.test.${label}.${Date.now()}.${counter}@example.com`
  const password = `Test${Math.random().toString(36).slice(2)}Aa1!`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ...(metadata ? { user_metadata: metadata } : {}),
  })
  if (error || !data.user) {
    throw new Error(`[legal-consents.test] Falha ao criar usuário: ${error?.message}`)
  }
  return { id: data.user.id, email, password }
}

const FULL_METADATA = {
  name: 'Teste B2',
  country_code: 'BR',
  terms_version: '2026-09-25',
  privacy_version: '2026-09-25',
  age_18_version: '1',
  marketing_email_version: '1',
}

describe.skipIf(!hasTestEnv())('legal_consents + handle_new_user (B2) — DEV', () => {
  let env: TestEnv
  let admin: SupabaseClient
  const created: DisposableUser[] = []
  let userA: DisposableUser
  let userB: DisposableUser
  let adminUser: DisposableUser
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientAdmin: SupabaseClient

  async function track(label: string, metadata?: Record<string, unknown>) {
    const user = await createUserWithMetadata(admin, label, metadata)
    created.push(user)
    return user
  }

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)

    userA = await track('legal-a', FULL_METADATA)
    userB = await track('legal-b', { ...FULL_METADATA, marketing_email_version: undefined })
    adminUser = await track('legal-admin')

    const { error } = await admin.from('profiles').update({ role: 'admin' }).eq('id', adminUser.id)
    if (error) throw new Error(`[legal-consents.test] Falha ao promover admin: ${error.message}`)

    // B2.1: consentimento só é gravado pelo SERVIDOR (recordSignupConsents, service_role) — nunca pela metadata.
    await recordSignupConsents(admin, userA.id, buildSignupConsents(true))
    await recordSignupConsents(admin, userB.id, buildSignupConsents(false))

    clientA = await signInAsDisposableUser(env, userA)
    clientB = await signInAsDisposableUser(env, userB)
    clientAdmin = await signInAsDisposableUser(env, adminUser)
  })

  afterAll(async () => {
    for (const user of created) {
      await deleteDisposableUser(admin, user.id)
    }
  })

  describe('fronteira de confiança — metadata do cliente NÃO é prova de consentimento', () => {
    it('conta criada com metadata de consentimento completa e FORJADA (como uma chamada direta ao GoTrue) → ZERO linhas em legal_consents', async () => {
      const forged = await track('legal-forged', { ...FULL_METADATA, age_confirmed: true, terms_accepted: true, privacy_accepted: true })
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', forged.id)
      expect(data).toEqual([])
    })

    it('mesmo assim o profile nasce completo (nome e país validado) — só o consentimento não é confiado', async () => {
      const forged = await track('legal-forged-profile', FULL_METADATA)
      const { data } = await admin.from('profiles').select('name, country_code').eq('id', forged.id).single()
      expect(data).toEqual({ name: 'Teste B2', country_code: 'BR' })
    })

    it('nenhum usuário que NÃO passou pelo servidor tem consentimento (as contas de teste sem gravação do servidor têm 0 linhas)', async () => {
      const { data } = await admin.from('legal_consents').select('user_id').eq('user_id', adminUser.id)
      expect(data).toEqual([])
    })
  })

  describe('gravação pelo servidor (recordSignupConsents)', () => {
    it('cadastro com marketing → terms, privacy, age_18 e marketing_email com as versões VIGENTES e source=signup', async () => {
      const { data, error } = await admin
        .from('legal_consents')
        .select('document_type, document_version, source')
        .eq('user_id', userA.id)
        .order('document_type')
      expect(error).toBeNull()
      expect(data).toEqual([
        { document_type: 'age_18', document_version: AGE_CONFIRMATION_VERSION, source: 'signup' },
        { document_type: 'marketing_email', document_version: MARKETING_OPT_IN_VERSION, source: 'signup' },
        { document_type: 'privacy', document_version: PRIVACY_VERSION, source: 'signup' },
        { document_type: 'terms', document_version: TERMS_VERSION, source: 'signup' },
      ])
    })

    it('é idempotente: repetir a gravação não duplica nem falha (ON CONFLICT DO NOTHING, sem UPDATE)', async () => {
      await recordSignupConsents(admin, userA.id, buildSignupConsents(true))
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', userA.id)
      expect((data ?? []).length).toBe(4)
    })

    it('falha do banco (usuário inexistente) LANÇA com mensagem fixa, sem vazar detalhe do banco', async () => {
      const error = await recordSignupConsents(admin, '00000000-0000-0000-0000-000000000000', buildSignupConsents(false)).catch((e: Error) => e)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Falha ao registrar os consentimentos legais do cadastro.')
    })

    it('uma versão nova de documento gera uma NOVA linha (histórico preservado, nunca sobrescrito)', async () => {
      const user = await track('legal-versions')
      await recordSignupConsents(admin, user.id, [{ documentType: 'terms', documentVersion: '2099-01-01' }])
      await recordSignupConsents(admin, user.id, [{ documentType: 'terms', documentVersion: '2099-06-01' }])
      const { data } = await admin.from('legal_consents').select('document_version').eq('user_id', user.id).eq('document_type', 'terms')
      expect((data ?? []).map((row) => row.document_version as string).sort()).toEqual(['2099-01-01', '2099-06-01'])
    })

    it('accepted_at é do servidor (próximo de agora), nunca vindo do cliente', async () => {
      const { data } = await admin.from('legal_consents').select('accepted_at').eq('user_id', userA.id).limit(1).single()
      const delta = Math.abs(Date.now() - new Date(data!.accepted_at as string).getTime())
      expect(delta).toBeLessThan(10 * 60 * 1000)
    })

    it('marketing NÃO informado → nenhuma linha marketing_email (opt-in nunca presumido)', async () => {
      const { data } = await admin.from('legal_consents').select('document_type').eq('user_id', userB.id)
      const types = (data ?? []).map((row) => row.document_type as string).sort()
      expect(types).toEqual(['age_18', 'privacy', 'terms'])
    })
  })

  describe('país no profile (não depende de UPDATE posterior do navegador)', () => {
    it('BR válido é persistido na criação do usuário', async () => {
      const { data } = await admin.from('profiles').select('country_code, name').eq('id', userA.id).single()
      expect(data?.country_code).toBe('BR')
      expect(data?.name).toBe('Teste B2')
    })

    it.each([
      ['código inexistente (XX)', 'XX'],
      ['minúsculo (br)', 'br'],
      ['nome por extenso', 'Brasil'],
      ['com espaço', 'BR '],
      ['vazio', ''],
      ['número', 55],
      ['objeto', { code: 'BR' }],
    ])('país inválido (%s) → profile criado com country_code NULL, sem falhar o cadastro', async (_label, value) => {
      const user = await track('legal-badcountry', { ...FULL_METADATA, country_code: value })
      const { data } = await admin.from('profiles').select('country_code').eq('id', user.id).single()
      expect(data?.country_code).toBeNull()
    })

    it('território que NÃO é sovereign_state é rejeitado (mesmo universo do seletor de residência)', async () => {
      const { data: nonSovereign } = await admin.from('countries').select('code').neq('type', 'sovereign_state').limit(1).single()
      expect(nonSovereign?.code).toBeTruthy()

      const user = await track('legal-dependency', { ...FULL_METADATA, country_code: nonSovereign!.code })
      const { data } = await admin.from('profiles').select('country_code').eq('id', user.id).single()
      expect(data?.country_code).toBeNull()
    })
  })

  describe('metadata parcial/ausente (Admin API, convites, conta de análise) — comportamento anterior preservado', () => {
    it('sem metadata: profile criado sem país e SEM consentimentos', async () => {
      const { data: profile } = await admin.from('profiles').select('id, country_code').eq('id', adminUser.id).single()
      expect(profile?.country_code).toBeNull()
      const { data: consents } = await admin.from('legal_consents').select('id').eq('user_id', adminUser.id)
      expect(consents).toEqual([])
    })

    it('só termos (sem privacidade/18+) → NADA é gravado (tudo-ou-nada)', async () => {
      const user = await track('legal-partial', { name: 'Parcial', terms_version: '2026-09-25' })
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', user.id)
      expect(data).toEqual([])
    })

    it('versão malformada → NADA é gravado e o usuário ainda é criado', async () => {
      const user = await track('legal-badversion', { ...FULL_METADATA, terms_version: 'versão inválida!' })
      const { data: consents } = await admin.from('legal_consents').select('id').eq('user_id', user.id)
      expect(consents).toEqual([])
      const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).single()
      expect(profile?.id).toBe(user.id)
    })

    it('marketing sozinho (sem o conjunto obrigatório) não é gravado', async () => {
      const user = await track('legal-marketing-only', { name: 'M', marketing_email_version: '1' })
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', user.id)
      expect(data).toEqual([])
    })
  })

  describe('RLS — leitura', () => {
    it('o usuário lê os PRÓPRIOS consentimentos', async () => {
      const { data, error } = await clientA.from('legal_consents').select('document_type')
      expect(error).toBeNull()
      expect((data ?? []).length).toBe(4)
    })

    it('sem acesso cruzado: B não enxerga nenhuma linha de A (nem por filtro explícito)', async () => {
      const { data, error } = await clientB.from('legal_consents').select('id').eq('user_id', userA.id)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('admin autorizado (is_platform_admin) lê os consentimentos de outros usuários', async () => {
      const { data, error } = await clientAdmin.from('legal_consents').select('id').eq('user_id', userA.id)
      expect(error).toBeNull()
      expect((data ?? []).length).toBe(4)
    })

    it('anon não lê nada (sem privilégio)', async () => {
      const anon = createAnonClient(env)
      const { data, error } = await anon.from('legal_consents').select('id')
      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })
  })

  describe('escrita direta bloqueada (append-only)', () => {
    it('INSERT por authenticated (inclusive para si mesmo) é bloqueado', async () => {
      const { data, error } = await clientA
        .from('legal_consents')
        .insert({ user_id: userA.id, document_type: 'cookies', document_version: '2026-09-25', source: 'signup' })
        .select()
      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })

    it('INSERT por authenticated em nome de outro usuário é bloqueado', async () => {
      const { error } = await clientA
        .from('legal_consents')
        .insert({ user_id: userB.id, document_type: 'cookies', document_version: '2026-09-25', source: 'signup' })
      expect(error).not.toBeNull()
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', userB.id).eq('document_type', 'cookies')
      expect(data).toEqual([])
    })

    it('INSERT por anon é bloqueado', async () => {
      const anon = createAnonClient(env)
      const { error } = await anon
        .from('legal_consents')
        .insert({ user_id: userA.id, document_type: 'cookies', document_version: '2026-09-25', source: 'signup' })
      expect(error).not.toBeNull()
    })

    it('UPDATE por authenticated é bloqueado e o registro fica intacto', async () => {
      await clientA.from('legal_consents').update({ document_version: '9999' }).eq('user_id', userA.id)
      const { data } = await admin.from('legal_consents').select('document_version').eq('user_id', userA.id).eq('document_type', 'terms').single()
      expect(data?.document_version).toBe('2026-09-25')
    })

    it('UPDATE é rejeitado até para service_role (trigger de imutabilidade)', async () => {
      const { error } = await admin.from('legal_consents').update({ source: 'tampered' }).eq('user_id', userA.id)
      expect(error).not.toBeNull()
      const { data } = await admin.from('legal_consents').select('source').eq('user_id', userA.id)
      expect((data ?? []).every((row) => row.source === 'signup')).toBe(true)
    })

    it('DELETE por authenticated é bloqueado (as 4 linhas continuam)', async () => {
      await clientA.from('legal_consents').delete().eq('user_id', userA.id)
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', userA.id)
      expect((data ?? []).length).toBe(4)
    })

    it('DELETE por anon é bloqueado', async () => {
      const anon = createAnonClient(env)
      await anon.from('legal_consents').delete().eq('user_id', userA.id)
      const { data } = await admin.from('legal_consents').select('id').eq('user_id', userA.id)
      expect((data ?? []).length).toBe(4)
    })
  })

  describe('constraints — tipo/versão/source controlados', () => {
    const base = { document_version: '2026-09-25', source: 'signup' }

    it('document_type inválido é rejeitado (mesmo via service_role)', async () => {
      const { error } = await admin.from('legal_consents').insert({ user_id: adminUser.id, document_type: 'bogus', ...base })
      expect(error).not.toBeNull()
    })

    it('document_version vazia ou malformada é rejeitada', async () => {
      for (const version of ['', ' ', '-x', 'a b', 'x'.repeat(65)]) {
        const { error } = await admin
          .from('legal_consents')
          .insert({ user_id: adminUser.id, document_type: 'terms', document_version: version, source: 'signup' })
        expect(error, `versão "${version}"`).not.toBeNull()
      }
    })

    it('source vazio/maiúsculo é rejeitado', async () => {
      for (const source of ['', 'Signup', '1abc']) {
        const { error } = await admin
          .from('legal_consents')
          .insert({ user_id: adminUser.id, document_type: 'terms', document_version: '2026-09-25', source })
        expect(error, `source "${source}"`).not.toBeNull()
      }
    })

    it('user_id inexistente é rejeitado pela FK', async () => {
      const { error } = await admin
        .from('legal_consents')
        .insert({ user_id: '00000000-0000-0000-0000-000000000000', document_type: 'terms', ...base })
      expect(error).not.toBeNull()
    })

    it('mesma (user, tipo, versão) não duplica', async () => {
      const first = await admin.from('legal_consents').insert({ user_id: adminUser.id, document_type: 'terms', ...base })
      expect(first.error).toBeNull()
      const second = await admin.from('legal_consents').insert({ user_id: adminUser.id, document_type: 'terms', ...base })
      expect(second.error).not.toBeNull()
    })
  })

  describe('exclusão de conta', () => {
    it('a exclusão do usuário remove os consentimentos (ON DELETE CASCADE) — DELETE só existe por esse caminho', async () => {
      const user = await track('legal-delete', FULL_METADATA)
      await recordSignupConsents(admin, user.id, buildSignupConsents(true))
      const before = await admin.from('legal_consents').select('id').eq('user_id', user.id)
      expect((before.data ?? []).length).toBe(4)

      await deleteDisposableUser(admin, user.id)
      created.splice(created.indexOf(user), 1) // já removido — o afterAll não repete

      const after = await admin.from('legal_consents').select('id').eq('user_id', user.id)
      expect(after.data).toEqual([])
    })
  })
})
