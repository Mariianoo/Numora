/**
 * lib/supabase/server.ts
 * Client Supabase para uso em Server Components, Server Actions e Route
 * Handlers. Lê/escreve a sessão via cookies do request atual — continua
 * respeitando RLS (usa `anon key` + JWT do usuário, nunca `service_role`).
 *
 * PROJECT_RULES.md §11.1: este é o client "server", distinto de "admin"
 * (service_role — ver admin.ts).
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { clientEnv } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Cria um novo client por request (nunca singleton aqui — cada request tem
 * seu próprio conjunto de cookies/sessão).
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // `setAll` chamado de um Server Component (não de uma Server
            // Action/Route Handler) não pode gravar cookies — é seguro
            // ignorar aqui, pois o middleware (middleware.ts) já garante a
            // renovação de sessão em toda navegação.
          }
        },
      },
    },
  )
}
