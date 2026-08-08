/**
 * features/auth/types.ts
 * Tipagens de domínio da feature de autenticação — item "Tipagens" do
 * escopo desta sprint.
 *
 * Estes tipos representam o modelo de SESSÃO (quem está autenticado e com
 * que status), não o modelo de negócio do usuário (que é `Profile`, de
 * DATABASE_ARCHITECTURE.md — consumido por outras features via seu próprio
 * repositório quando essa feature existir).
 */

/**
 * Recorte mínimo do usuário autenticado, relevante à camada de sessão.
 * Deliberadamente menor que `profiles` completo (DATABASE_ARCHITECTURE.md)
 * — dados de perfil de negócio pertencem a uma feature de "profile" futura,
 * não a esta.
 */
export interface AuthUser {
  id: string
  email: string | null
  role: 'visitor' | 'user' | 'verified_seller' | 'moderator' | 'admin' | 'system' | 'ai'
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
  expiresAt: number | null
}

/**
 * Estado do ciclo de vida da sessão no client:
 * - `idle`: ainda não verificado (estado inicial, antes do primeiro check)
 * - `loading`: verificação em andamento
 * - `authenticated`: sessão válida presente
 * - `unauthenticated`: verificado, sem sessão válida
 */
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  session: AuthSession | null
}
