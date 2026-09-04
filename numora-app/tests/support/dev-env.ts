/**
 * tests/support/dev-env.ts
 * Etapa "F2 — Closed Beta Test Suite" — único ponto de acesso a Supabase
 * para testes de integration/E2E. Nenhum teste deve chamar
 * `createClient()` diretamente; todos passam por aqui, para que o guard de
 * segurança abaixo seja sempre exercido.
 *
 * GUARD DE SEGURANÇA: `getTestEnv()` valida que `SUPABASE_TEST_URL` aponta
 * para o projeto DEV (`sfhnhgkicvtvhbwpttwh` — ref público, não é secret,
 * só identifica qual projeto Supabase é este) antes de devolver qualquer
 * client. Se apontar para Production (`iebttmvrjgwtvibuauxr`) ou qualquer
 * outro ref desconhecido, lança erro alto na hora — nunca um skip
 * silencioso, porque isso é sempre um erro de configuração perigoso, nunca
 * "ambiente ainda não configurado". Variáveis ausentes (nenhuma
 * configurada) retornam `null` — aí sim o caller deve pular o teste
 * explicitamente (`describe.skipIf`/`test.skip`), nunca inventar outro
 * projeto como fallback.
 *
 * `service_role` só é lido aqui e só deve ser usado por código que roda em
 * Node (setup/cleanup de dados de teste) — nunca dentro de `page.evaluate`
 * do Playwright, nunca em qualquer arquivo servido ao browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEV_PROJECT_REF = 'sfhnhgkicvtvhbwpttwh' // numora-development
const PRODUCTION_PROJECT_REF = 'iebttmvrjgwtvibuauxr' // numora — nunca usado por testes

export interface TestEnv {
  url: string
  anonKey: string
  serviceRoleKey: string
}

function extractProjectRef(url: string): string | null {
  return url.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? null
}

/**
 * `null` = variáveis de teste não configuradas neste ambiente — o caller
 * deve pular o teste explicitamente, nunca prosseguir. Lança erro (não
 * retorna `null`) quando as variáveis EXISTEM mas apontam para um projeto
 * errado — essa distinção é proposital: "não configurado" é uma condição
 * esperada em CI/máquinas novas; "configurado errado" é sempre um bug que
 * precisa parar tudo.
 */
export function getTestEnv(): TestEnv | null {
  const url = process.env.SUPABASE_TEST_URL
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

  if (!url || !anonKey || !serviceRoleKey) {
    return null
  }

  const ref = extractProjectRef(url)

  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `[tests/support/dev-env] SUPABASE_TEST_URL aponta para o projeto PRODUCTION (${PRODUCTION_PROJECT_REF}). ` +
        'Testes nunca podem rodar contra Production — abortando.',
    )
  }

  if (ref !== DEV_PROJECT_REF) {
    throw new Error(
      `[tests/support/dev-env] SUPABASE_TEST_URL aponta para um projeto desconhecido (ref "${ref ?? '<inválido>'}"). ` +
        `Só o projeto DEV (${DEV_PROJECT_REF}) é permitido — abortando.`,
    )
  }

  return { url, anonKey, serviceRoleKey }
}

/** Atalho para `describe.skipIf(!hasTestEnv())`/`test.skip(!hasTestEnv(), ...)`. */
export function hasTestEnv(): boolean {
  return getTestEnv() !== null
}

/** Client com a `anon key` — mesmo nível de privilégio de um browser real. Nunca usar para bypassar RLS. */
export function createAnonClient(env: TestEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Client `service_role` — só para setup/cleanup de dados de teste, nunca para exercer um caminho que deveria respeitar RLS. */
export function createAdminClient(env: TestEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export interface DisposableUser {
  id: string
  email: string
  password: string
}

let disposableUserCounter = 0

/**
 * Cria um usuário descartável via Admin API (NUNCA via signup público) —
 * já confirmado, pronto para logar de imediato via `signInWithPassword`.
 * `@example.com` (domínio reservado pela IANA para documentação/teste,
 * nunca entrega e-mail de verdade) — seguro para rodar em CI sem risco de
 * notificar ninguém real, mesmo se o teste rodar muitas vezes.
 */
export async function createDisposableUser(admin: SupabaseClient, label: string): Promise<DisposableUser> {
  disposableUserCounter += 1
  const email = `numora.test.${label}.${Date.now()}.${disposableUserCounter}@example.com`
  const password = `Test${Math.random().toString(36).slice(2)}Aa1!`

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) {
    throw new Error(`[tests/support/dev-env] Falha ao criar usuário descartável: ${error?.message}`)
  }

  return { id: data.user.id, email, password }
}

/**
 * Remove um usuário descartável.
 *
 * ACHADO DESTA ETAPA: chamar `auth.admin.deleteUser()` diretamente em um
 * usuário com linhas em `collection_units` falha com `500 "Database
 * error deleting user"` (`AuthRetryableFetchError`) — reproduzido de
 * forma consistente (não é flakiness) contra o projeto DEV durante a
 * escrita desta suíte. Chamar `delete_own_account_data` (RPC, remove
 * `profiles` + cascade completo do schema `public`) ANTES de
 * `deleteUser` evita o problema — exatamente a ordem que
 * `app/api/account/delete/route.ts` já usa em produção (por isso o fluxo
 * real do app nunca esteve exposto a isso). Reportado no relatório desta
 * etapa; corrigir a causa raiz (provavelmente permissão/trigger que
 * `supabase_auth_admin` não consegue satisfazer ao cascatear
 * `collection_units` a partir do schema `auth`) fica para uma etapa
 * futura — não investigado nem alterado aqui.
 *
 * NUNCA limpa Storage (fora do cascade do Postgres) — quem sobe arquivo
 * de teste precisa remover explicitamente. Idempotente: 404 (usuário já
 * removido) nunca é tratado como falha.
 */
export async function deleteDisposableUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error: rpcError } = await admin.rpc('delete_own_account_data', { p_user_id: userId })
  if (rpcError) {
    throw new Error(`[tests/support/dev-env] Falha ao limpar dados do usuário descartável ${userId}: ${rpcError.message}`)
  }

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error && error.status !== 404) {
    throw new Error(`[tests/support/dev-env] Falha ao limpar usuário descartável ${userId}: ${error.message}`)
  }
}

const COIN_IMAGE_BUCKETS = ['coin-images', 'coin-images-public']

/**
 * Remove TODOS os objetos de Storage de um usuário descartável, nos dois
 * buckets de fotos (`coin-images` privado, `coin-images-public`
 * derivado) — nenhum dos dois é limpo pelo cascade do Postgres nem por
 * `deleteDisposableUser`. Mesma lógica de 2 níveis de `list()` usada por
 * `app/api/account/delete/route.ts` (`storage.list()` não é recursivo).
 * Chamar ANTES de `deleteDisposableUser` em qualquer teste que faça
 * upload real de foto (ex.: `tests/e2e/passport.spec.ts`) — esquecer
 * disso deixa objetos órfãos em DEV (achado real desta etapa).
 */
export async function cleanupUserStorage(admin: SupabaseClient, userId: string): Promise<void> {
  for (const bucket of COIN_IMAGE_BUCKETS) {
    const { data: firstLevel } = await admin.storage.from(bucket).list(userId, { limit: 1000 })
    for (const entry of firstLevel ?? []) {
      if (entry.metadata === null) {
        // Sem metadata = "pasta" (prefixo), não arquivo — mais um nível.
        const subPath = `${userId}/${entry.name}`
        const { data: secondLevel } = await admin.storage.from(bucket).list(subPath, { limit: 1000 })
        const paths = (secondLevel ?? []).map((file) => `${subPath}/${file.name}`)
        if (paths.length > 0) {
          await admin.storage.from(bucket).remove(paths)
        }
      } else {
        await admin.storage.from(bucket).remove([`${userId}/${entry.name}`])
      }
    }
  }
}

/** Assina como o usuário descartável — devolve um client com sessão real (nunca `service_role`). */
export async function signInAsDisposableUser(env: TestEnv, user: DisposableUser): Promise<SupabaseClient> {
  const client = createAnonClient(env)
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) {
    throw new Error(`[tests/support/dev-env] Falha ao logar usuário descartável ${user.email}: ${error.message}`)
  }
  return client
}
