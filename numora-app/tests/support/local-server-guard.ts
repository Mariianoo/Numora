/**
 * tests/support/local-server-guard.ts
 * Etapa "B2.5.7.1" — lógica PURA (sem rede, sem Playwright) das proteções dos E2E que exercitam o
 * cadastro de verdade: o servidor sob teste precisa ser LOCAL e precisa apontar para o Supabase DEV.
 * A parte que fala com o servidor está em tests/e2e/support/local-server.ts; aqui ficam as decisões,
 * para serem provadas por teste unitário.
 *
 * Por que olhar o ref no código servido: os três clients Supabase do app (admin, servidor e navegador)
 * leem a MESMA variável `NEXT_PUBLIC_SUPABASE_URL` (lib/env.server.ts). Ela é inlinada nos chunks do
 * navegador, então o ref que o servidor local realmente usa aparece no que ele serve — algo que
 * `SUPABASE_TEST_URL` (variável do PROCESSO DE TESTE) não prova. A validade não depende do estado das
 * migrations nem de nenhuma RPC existir: a decisão é só sobre o ref.
 */
import { DEV_PROJECT_REF, PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-ref'

export const DEFAULT_E2E_BASE_URL = 'http://localhost:3000'

/** Mesma regra do playwright.config.ts: `PLAYWRIGHT_BASE_URL`, com fallback local — nunca Production. */
export function resolveE2EBaseURL(env: Record<string, string | undefined> = process.env): string {
  return env.PLAYWRIGHT_BASE_URL ?? DEFAULT_E2E_BASE_URL
}

/**
 * `true` só para `localhost` e `127.0.0.1`, comparados pelo HOSTNAME já interpretado pelo parser de URL
 * (portanto `localhost.evil.com`, `evil.com/localhost` e `http://localhost@evil.com` são remotos), sem
 * credenciais embutidas e só em http/https. Qualquer outra coisa — Production, Preview, qualquer
 * hostname remoto, URL inválida — é `false`.
 */
export function isLocalBaseURL(baseURL: string): boolean {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

/** Refs de projeto Supabase (20 caracteres) encontrados em `https://<ref>.supabase.co` dentro de um texto. */
export function extractSupabaseRefs(text: string): Set<string> {
  const refs = new Set<string>()
  for (const match of text.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)) refs.add(match[1])
  return refs
}

export type ServerProjectVerdict =
  | { ok: true; ref: string }
  | { ok: false; reason: 'no_supabase_url_found' | 'production' | 'unexpected_project'; refs: string[] }

/**
 * Veredito sobre os refs que o servidor serve. Falha FECHADO: sem nenhum ref não há prova (reprova);
 * qualquer ref de Production — mesmo misturado ao do DEV — reprova; qualquer ref diferente do DEV reprova.
 */
export function judgeServerSupabaseRefs(refs: Iterable<string>): ServerProjectVerdict {
  const found = [...new Set(refs)].sort()
  if (found.length === 0) return { ok: false, reason: 'no_supabase_url_found', refs: found }
  if (found.includes(PRODUCTION_PROJECT_REF)) return { ok: false, reason: 'production', refs: found }
  if (found.length !== 1 || found[0] !== DEV_PROJECT_REF) return { ok: false, reason: 'unexpected_project', refs: found }
  return { ok: true, ref: found[0] }
}
