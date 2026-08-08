/**
 * lib/env.ts
 * Configuração de ambiente — toda variável usada pela aplicação passa por
 * aqui, nunca acessada via `process.env.X` diretamente em código de feature
 * (PROJECT_RULES.md §8.3: toda fronteira externa é validada com Zod).
 */
import { z } from 'zod'

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

function parseClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

export const clientEnv = parseClientEnv()
