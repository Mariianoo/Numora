/**
 * features/auth/types.ts
 * Tipagens de domínio da feature de autenticação.
 *
 * Estes tipos representam o modelo de SESSÃO (quem está autenticado e com
 * que status), não o modelo de negócio do usuário (que virá de uma tabela
 * `profiles`/feature de perfil futura).
 */

/**
 * Recorte mínimo do usuário autenticado, relevante à camada de sessão.
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

/**
 * Dados do formulário de cadastro (Etapa 7 — e-mail/senha). `name` e
 * `countryCode` vão via `options.data` do `signUp()`: `name` é lido pelo
 * trigger `handle_new_user` (banco) para popular `profiles.name`;
 * `countryCode` não é lido pelo trigger — é aplicado separadamente pelo
 * repositório (ver auth.repository.ts) depois que há sessão.
 */
export interface SignUpInput {
  name: string
  email: string
  password: string
  countryCode: string | null
}

export interface SignUpResult {
  /**
   * `true` = o Supabase já retornou uma sessão ativa (Confirm email
   * desabilitado). `false` = cadastro criado, mas a sessão só existe
   * depois que o usuário confirmar o e-mail (cenário confirmado como o
   * real deste projeto).
   */
  hasSession: boolean
}
