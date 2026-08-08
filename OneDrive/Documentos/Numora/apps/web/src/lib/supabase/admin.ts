/**
 * lib/supabase/admin.ts
 * Client Supabase com `service_role` — bypassa RLS.
 *
 * USO RESTRITO (PROJECT_RULES.md §11.1, §26.2 de SYSTEM_ARCHITECTURE.md):
 * exclusivo de Edge Functions e jobs internos de confiança. NUNCA importar
 * este módulo em um caminho alcançável diretamente por uma requisição de
 * usuário sem checagem explícita de privilégio administrativo antes.
 *
 * A checagem abaixo lança erro imediatamente caso este módulo seja avaliado
 * em runtime de browser (bundle client) — não depende de nenhuma dependência
 * externa adicional, apenas de `typeof window`.
 */
import { createClient } from '@supabase/supabase-js'

import { clientEnv, getServerOnlyEnv } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'

if (typeof window !== 'undefined') {
  throw new Error(
    '[lib/supabase/admin.ts] Este módulo é server-only e não pode ser importado em código client. ' +
      'Use lib/supabase/client.ts em Client Components.',
  )
}

let adminClient: ReturnType<typeof createClient<Database>> | undefined

/**
 * Retorna uma instância singleton do client administrativo. Singleton é
 * seguro aqui pois este client nunca carrega estado de sessão de usuário
 * (não usa cookies — cada chamada é explicitamente autenticada como
 * `service_role`).
 */
export function getSupabaseAdminClient() {
  if (!adminClient) {
    const { SUPABASE_SERVICE_ROLE_KEY } = getServerOnlyEnv()

    adminClient = createClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )
  }

  return adminClient
}
