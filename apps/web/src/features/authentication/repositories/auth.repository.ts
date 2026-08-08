/**
 * features/auth/repositories/auth-repository.ts
 * Infrastructure layer da feature de auth (PROJECT_RULES.md §4.2,
 * DEVELOPMENT_GUIDE.md §14) — única camada que conhece o SDK do Supabase
 * Auth diretamente. `AuthService` depende apenas da interface `AuthRepository`,
 * nunca desta implementação diretamente.
 *
 * Escopo desta sprint: apenas operações de SESSÃO (obter, observar, encerrar).
 * Métodos de login/cadastro/OAuth/MFA/recuperação de senha são
 * deliberadamente NÃO incluídos aqui — pertencem a uma sprint futura de
 * "Auth Flows", fora do escopo de "Authentication Foundation".
 */
import type { Session } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AuthSession, AuthUser } from '@/features/auth/types'

export interface AuthRepository {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  signOut(): Promise<void>
}

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session?.user) return null

  const user: AuthUser = {
    id: session.user.id,
    email: session.user.email ?? null,
    // `role` chega via custom claim do JWT (API_CONVENTIONS.md §2 — claims
    // mínimas incluem `role`). Fallback para 'user' se a claim ainda não
    // estiver presente no token (ex.: sessão criada antes da claim existir).
    role: (session.user.app_metadata?.role as AuthUser['role'] | undefined) ?? 'user',
  }

  return {
    user,
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? null,
  }
}

export function createSupabaseAuthRepository(): AuthRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async getSession() {
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        throw new Error(`[AuthRepository] Falha ao obter sessão: ${error.message}`)
      }
      return toAuthSession(data.session)
    },

    onAuthStateChange(callback) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(toAuthSession(session))
      })

      return () => subscription.unsubscribe()
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) {
        throw new Error(`[AuthRepository] Falha ao encerrar sessão: ${error.message}`)
      }
    },
  }
}
