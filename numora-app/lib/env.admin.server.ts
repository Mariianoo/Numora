/**
 * lib/env.admin.server.ts
 * Etapa 15.10.17B — schema de ambiente EXCLUSIVAMENTE server-only, separado
 * de `lib/env.server.ts` de propósito.
 *
 * `lib/env.server.ts` (`clientEnv`) só valida variáveis `NEXT_PUBLIC_*` —
 * seguras por design de aparecer no bundle do browser — e é importado tanto
 * por `lib/supabase/client.ts` (Client Component) quanto por
 * `lib/supabase/server.ts` (Server Component). `SUPABASE_SERVICE_ROLE_KEY`
 * NUNCA pode entrar nesse mesmo módulo: qualquer import futuro acidental de
 * `clientEnv` a partir de um Client Component levaria a chave inteira para o
 * bundle do cliente. Por isso este arquivo é um módulo à parte, importado
 * SOMENTE por `lib/supabase/admin.ts` — que por sua vez só pode ser
 * importado por código que roda exclusivamente no servidor (Route Handlers).
 *
 * Sem prefixo `NEXT_PUBLIC_` de propósito — variáveis sem esse prefixo nunca
 * são substituídas no bundle do Next.js, permanecem só em `process.env` do
 * lado do servidor.
 */
import { z } from 'zod'

const adminEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

export type AdminEnv = z.infer<typeof adminEnvSchema>

function parseAdminEnv(): AdminEnv {
  const parsed = adminEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })

  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente (admin/server-only) inválidas ou ausentes:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    )
  }

  return parsed.data
}

/**
 * Lazy (não módulo-level como `clientEnv`) — só valida quando efetivamente
 * chamado, para nunca lançar em nenhum caminho de build/import que não
 * precise da service role (ex.: qualquer rota que importe `lib/supabase/
 * admin.ts` indiretamente sem nunca chamar a função que a usa).
 */
export function getAdminEnv(): AdminEnv {
  return parseAdminEnv()
}
