/**
 * features/auth/repositories/auth.repository.ts
 * Infrastructure layer da feature de auth (PROJECT_RULES.md §4.2,
 * DEVELOPMENT_GUIDE.md §14) — única camada que conhece o SDK do Supabase
 * Auth diretamente. `AuthService` depende apenas da interface `AuthRepository`,
 * nunca desta implementação diretamente.
 *
 * Escopo: operações de SESSÃO (obter, observar, encerrar) + login via Google
 * OAuth. Demais métodos (cadastro por email/senha, outros provedores, MFA,
 * recuperação de senha) ficam para uma etapa futura de "Auth Flows".
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AuthSession, AuthUser } from '@/features/auth/types'

export interface AuthRepository {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session?.user) return null

  const user: AuthUser = {
    id: session.user.id,
    email: session.user.email ?? null,
    // `role` chega via custom claim do JWT. Fallback para 'user' se a claim
    // ainda não estiver presente no token (ex.: sessão criada antes da
    // claim existir).
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
      } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
        callback(toAuthSession(session))
      })

      return () => subscription.unsubscribe()
    },

    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) {
        throw new Error(`[AuthRepository] Falha ao iniciar login com Google: ${error.message}`)
      }
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) {
        throw new Error(`[AuthRepository] Falha ao encerrar sessão: ${error.message}`)
      }
    },
  }
}
