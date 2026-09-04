/**
 * tests/integration/storage.test.ts
 * TESTE 04 (Etapa "F2 — Closed Beta Test Suite") — isolamento dos buckets
 * `coin-images` (privado) e `coin-images-public` contra Supabase DEV real.
 * Sessões reais de dois usuários (nunca `service_role` para exercer as
 * policies) — `service_role` só para cleanup garantido no `afterAll`.
 *
 * Path determinístico `{user_id}/...` (mesma convenção real do app) — as
 * policies de Storage usam `storage.foldername(name)[1] = auth.uid()`.
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

describe.skipIf(!hasTestEnv())('Storage — isolamento entre buckets e usuários', () => {
  let env: TestEnv
  let admin: SupabaseClient
  let userA: DisposableUser
  let userB: DisposableUser
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  const privatePath = () => `${userA.id}/storage-test-private.txt`
  const publicPath = () => `${userA.id}/storage-test-public.txt`

  beforeAll(async () => {
    env = getTestEnv()!
    admin = createAdminClient(env)
    userA = await createDisposableUser(admin, 'storage-a')
    userB = await createDisposableUser(admin, 'storage-b')
    clientA = await signInAsDisposableUser(env, userA)
    clientB = await signInAsDisposableUser(env, userB)
  })

  afterAll(async () => {
    // Cleanup garantido via service_role, independente de qual teste falhou.
    await admin.storage.from('coin-images').remove([privatePath()])
    await admin.storage.from('coin-images-public').remove([publicPath()])
    await deleteDisposableUser(admin, userA.id)
    await deleteDisposableUser(admin, userB.id)
  })

  it('A consegue subir e ler seu próprio objeto no bucket privado', async () => {
    const { error: uploadError } = await clientA.storage
      .from('coin-images')
      .upload(privatePath(), 'conteudo-privado-de-a', { contentType: 'text/plain', upsert: true })
    expect(uploadError).toBeNull()

    const { data, error } = await clientA.storage.from('coin-images').download(privatePath())
    expect(error).toBeNull()
    expect(await data?.text()).toBe('conteudo-privado-de-a')
  })

  it('B NÃO consegue ler o objeto privado de A', async () => {
    const { data, error } = await clientB.storage.from('coin-images').download(privatePath())
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('B NÃO consegue escrever na pasta de A no bucket privado', async () => {
    const { error } = await clientB.storage
      .from('coin-images')
      .upload(`${userA.id}/hacked-by-b.txt`, 'invasao', { contentType: 'text/plain' })
    expect(error).not.toBeNull()
  })

  it('objeto público derivado é acessível sem sessão nenhuma (fetch anônimo, como a página pública do Passport faz)', async () => {
    const { error: uploadError } = await clientA.storage
      .from('coin-images-public')
      .upload(publicPath(), 'conteudo-publico-de-a', { contentType: 'text/plain', upsert: true })
    expect(uploadError).toBeNull()

    const { data: urlData } = clientA.storage.from('coin-images-public').getPublicUrl(publicPath())

    // Fetch cru, sem nenhum header de autenticação/apikey — exatamente como
    // um visitante anônimo da internet carregando <img src="..."> no
    // Passport público.
    const response = await fetch(urlData.publicUrl)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('conteudo-publico-de-a')
  })

  it('o bucket público NÃO expõe o objeto PRIVADO original, mesmo construindo a mesma URL pública para o path do bucket privado', async () => {
    const { data: urlData } = clientA.storage.from('coin-images').getPublicUrl(privatePath())
    const response = await fetch(urlData.publicUrl)
    expect(response.status).not.toBe(200)
  })
})
