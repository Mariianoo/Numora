/**
 * config/env.ts
 * Configuração de ambiente (item 26 — Sprint Foundation).
 *
 * Toda variável de ambiente usada pela aplicação passa por este módulo —
 * nunca acessada via `process.env.X` diretamente em código de feature
 * (PROJECT_RULES.md §8.3: toda fronteira externa é validada com Zod).
 *
 * Variáveis client-side (expostas ao browser) exigem o prefixo
 * `NEXT_PUBLIC_` por convenção do Next.js e são validadas separadamente das
 * variáveis server-only, para nunca permitir que um segredo vaze para o
 * schema client por engano (PROJECT_RULES.md §10.5).
 */
import { z } from 'zod'

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_ENV: z.enum(['local', 'staging', 'production']).default('local'),
})

const serverOnlyEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>
export type ServerOnlyEnv = z.infer<typeof serverOnlyEnvSchema>

function parseClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
  })

  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente (client) inválidas ou ausentes:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    )
  }

  return parsed.data
}

/**
 * Só chamar em contexto server-side (Route Handler, Server Action, Edge
 * Function) — nunca importado por um componente marcado "use client".
 */
function parseServerOnlyEnv(): ServerOnlyEnv {
  const parsed = serverOnlyEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })

  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente (server-only) inválidas ou ausentes:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    )
  }

  return parsed.data
}

export const clientEnv = parseClientEnv()

export function getServerOnlyEnv(): ServerOnlyEnv {
  return parseServerOnlyEnv()
}
