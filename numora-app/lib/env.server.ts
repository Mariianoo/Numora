/**
 * lib/env.server.ts
 * Configuração de ambiente (Zod) — usada por lib/supabase/client.ts e
 * lib/supabase/server.ts (Node runtime / browser bundle), NUNCA por
 * middleware.ts (Edge Runtime). Renomeado de env.ts para env.server.ts de
 * propósito, para deixar explícito no nome do arquivo que isto não deve
 * ser importado de código que roda em Edge.
 *
 * `NEXT_PUBLIC_GTM_ID` (Etapa 15.10.1): `.optional()` de propósito — o
 * GTM nunca deve ser inventado/hardcoded (auditoria da Etapa 15.10).
 * Ausente = `components/analytics/GoogleTagManager.tsx` não renderiza
 * nada; a variável só existe de verdade quando configurada no ambiente de
 * deploy (ex.: Production na Vercel), nunca em Development/Preview a
 * menos que o próprio deploy defina — sem lógica extra de "modo debug".
 */
import { z } from 'zod'

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

function parseClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
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
