/**
 * tests/e2e/support/local-server.ts
 * Etapa "B2.5.7.1" — prova, ANTES de qualquer teste com efeito, que o servidor sob teste é LOCAL e
 * aponta para o Supabase DEV. Duas provas independentes, ambas falhando fechado:
 *
 *  A. ref servido: os chunks que o servidor entrega (login e signup) trazem a URL efetiva do
 *     Supabase (`NEXT_PUBLIC_SUPABASE_URL`, a mesma variável dos clients admin/servidor/navegador).
 *     Tem de aparecer exatamente o ref do DEV — nenhum ref de Production, nenhum outro, e ao menos um.
 *  B. canário no servidor: um usuário descartável é criado no DEV, e o servidor local confirma o
 *     e-mail dele pelo POST real de /api/auth/confirm. Isso só funciona se o `verifyOtp` do servidor
 *     falar com o MESMO projeto onde o token nasceu. Apontando para Production, o token é
 *     desconhecido e nada é alterado lá (a confirmação simplesmente falha).
 *
 * Nenhuma dessas provas depende do estado das migrations, de RPCs nem de variáveis do processo de
 * teste. Nenhum segredo é lido, impresso ou escrito aqui: o client administrativo (DEV) chega por
 * parâmetro e as mensagens de erro só citam refs públicos de projeto.
 */
import { randomUUID } from 'node:crypto'
import { request as playwrightRequest } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { DEV_PROJECT_REF, PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-ref'
import { extractSupabaseRefs, isLocalBaseURL, judgeServerSupabaseRefs } from '../../support/local-server-guard'

const MAX_CHUNKS_PER_PAGE = 80

/** Coleta os refs de Supabase presentes no HTML e nos scripts (`/_next/...`) servidos por /login e /signup. */
export async function collectServedSupabaseRefs(baseURL: string): Promise<Set<string>> {
  const context = await playwrightRequest.newContext({ baseURL })
  try {
    const refs = new Set<string>()
    for (const page of ['/login', '/signup']) {
      const response = await context.get(page)
      if (!response.ok()) continue
      const html = await response.text()
      for (const ref of extractSupabaseRefs(html)) refs.add(ref)

      const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((src) => src.startsWith('/_next/'))
        .slice(0, MAX_CHUNKS_PER_PAGE)
      for (const src of scripts) {
        const chunk = await context.get(src)
        if (chunk.ok()) for (const ref of extractSupabaseRefs(await chunk.text())) refs.add(ref)
      }
    }
    return refs
  } finally {
    await context.dispose()
  }
}

export interface ServerGuardOptions {
  baseURL: string
  /** Client administrativo do DEV (já protegido por tests/support/dev-env). */
  admin: SupabaseClient
  /** Chamado com o id do usuário-canário para o spec removê-lo ao final. */
  onCanaryUser: (userId: string) => void
}

export async function assertServerUsesDevSupabase({ baseURL, admin, onCanaryUser }: ServerGuardOptions): Promise<void> {
  if (!isLocalBaseURL(baseURL)) {
    throw new Error(`E2E recusado: baseURL "${baseURL}" não é local (só localhost ou 127.0.0.1). Este teste cria contas e consome rate limit de verdade.`)
  }

  // A — o ref que o servidor serve
  const verdict = judgeServerSupabaseRefs(await collectServedSupabaseRefs(baseURL))
  if (!verdict.ok) {
    const detail =
      verdict.reason === 'production'
        ? `o servidor local aponta para o projeto de PRODUCTION (${PRODUCTION_PROJECT_REF})`
        : verdict.reason === 'unexpected_project'
          ? `o servidor local aponta para um projeto que não é o DEV (refs: ${verdict.refs.join(', ')})`
          : 'não foi possível provar o projeto Supabase do servidor local (nenhuma URL do Supabase encontrada nos chunks servidos)'
    throw new Error(`E2E recusado: ${detail}. Esperado: o DEV (${DEV_PROJECT_REF}). Confira o .env.local do servidor de teste.`)
  }

  // B — canário: o servidor confirma, pelo POST real, um token nascido no DEV
  const email = `numora.test.e2e-guard.${Date.now()}@example.com`
  const password = `E2e!${randomUUID().slice(0, 8)}Aa1x`
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { name: 'Canário do guard' },
    app_metadata: { signup_flow: 'public_v1', signup_attempt_nonce: `e2e-guard-${randomUUID()}`, signup_state: 'ready' },
  })
  if (createError || !created.user) throw new Error(`E2E recusado: não foi possível criar o usuário-canário no DEV (${createError?.message}).`)
  onCanaryUser(created.user.id)

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'signup', email, password, options: { redirectTo: `${baseURL}/auth/confirm` } })
  const token = link?.properties?.hashed_token
  if (linkError || !token) throw new Error(`E2E recusado: não foi possível gerar o token-canário no DEV (${linkError?.message}).`)

  const context = await playwrightRequest.newContext({ baseURL })
  try {
    const response = await context.post('/api/auth/confirm', { headers: { Origin: baseURL }, form: { token_hash: token, type: 'signup' }, maxRedirects: 0 })
    const location = response.headers().location ?? ''
    if (response.status() !== 303 || new URL(location, baseURL).pathname !== '/auth/set-password') {
      throw new Error(
        'E2E recusado: o servidor local NÃO consumiu um token criado no DEV — ele não aponta para o mesmo projeto (ou não está em modo de teste com a origem canônica local). ' +
          `Esperado: o DEV (${DEV_PROJECT_REF}).`,
      )
    }
  } finally {
    await context.dispose()
  }

  const { data: confirmed } = await admin.auth.admin.getUserById(created.user.id)
  if (!confirmed.user?.email_confirmed_at) {
    throw new Error('E2E recusado: o canário não aparece confirmado no DEV — o servidor local não grava no DEV.')
  }
}
