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
 * Payload do cadastro enviado a POST /api/auth/signup (Etapa "B2.4 — Signup
 * server-controlled"). NÃO há senha: a conta nasce com uma senha aleatória
 * descartada no servidor e o usuário define a real depois de confirmar o
 * e-mail. A validação que vale é a do servidor
 * (lib/auth/signup-validation.ts); os consentimentos são gravados SÓ pelo
 * servidor (nenhuma metadata do cliente é prova de aceite).
 */
export interface SignUpInput {
  name: string
  email: string
  /** V1: somente "BR" (o servidor rejeita qualquer outro valor). */
  countryCode: string
  termsAccepted: boolean
  privacyAccepted: boolean
  age18Confirmed: boolean
  /** Opt-in de marketing — opcional, separado, nunca pré-marcado. */
  marketingOptIn: boolean
  /** Versões exibidas ao usuário no formulário (o servidor exige a vigente). */
  termsVersion: string
  privacyVersion: string
  ageConfirmationVersion: string
  /** Token do Turnstile (verificado no servidor; só quando o CAPTCHA está configurado). */
  captchaToken?: string
}

/** O cadastro nunca devolve sessão: a conta só fica ativa após confirmar o e-mail. */
export interface SignUpResult {
  needsEmailConfirmation: true
}
