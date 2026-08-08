/**
 * lib/supabase/client.ts
 * Client Supabase para uso em Client Components ("use client").
 *
 * Usa a `anon key` — toda leitura/escrita passa por RLS normalmente
 * (PROJECT_RULES.md §11.1). NUNCA importar `service_role` aqui.
 */
'use client'

import { createBrowserClient } from '@supabase/ssr'

import { clientEnv } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

/**
 * Retorna uma instância singleton do client Supabase de browser.
 * Singleton evita múltiplas conexões/listeners redundantes em re-renders.
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    )
  }

  return browserClient
}
