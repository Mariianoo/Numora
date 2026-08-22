/**
 * lib/supabase/admin.ts
 * Etapa 15.10.17B — client Supabase com a `service_role` key. Usa
 * `createClient` de `@supabase/supabase-js` diretamente (não
 * `@supabase/ssr`/`createServerClient`): este client não representa uma
 * sessão de navegador via cookies — é uma identidade de servidor própria,
 * sem sessão de usuário, usada só para as 3 operações que exigem privilégio
 * administrativo (Admin API de Auth, limpeza de Storage entre usuários,
 * chamar `delete_own_account_data` com o GRANT correto).
 *
 * NUNCA importar este arquivo de um Client Component ou de qualquer código
 * que possa acabar no bundle do browser — só de Route Handlers
 * (`app/api/**`). `getAdminEnv()` (lib/env.admin.server.ts) é a única fonte
 * da chave; nunca lida de `clientEnv`.
 *
 * `auth: { autoRefreshToken: false, persistSession: false }`: este client
 * nunca deve manter/renovar uma sessão de usuário — cada instância vive só
 * durante o processamento de uma requisição.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { clientEnv } from '@/lib/env.server'
import { getAdminEnv } from '@/lib/env.admin.server'

export function getSupabaseAdminClient(): SupabaseClient {
  const { SUPABASE_SERVICE_ROLE_KEY } = getAdminEnv()

  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
