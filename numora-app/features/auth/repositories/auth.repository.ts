/**
 * features/auth/repositories/auth.repository.ts
 * Infrastructure layer da feature de auth (PROJECT_RULES.md §4.2,
 * DEVELOPMENT_GUIDE.md §14) — única camada que conhece o SDK do Supabase
 * Auth diretamente.
 *
 * Etapa 7: método principal de login passa a ser e-mail/senha.
 * `signInWithGoogle` é mantido no código, sem uso na UI — Google Cloud e
 * o provider no Supabase continuam configurados; reativar no futuro é só
 * voltar a chamar este método a partir da UI, sem mudança de arquitetura.
 *
 * Etapa 15.10.2 (histórico): a atribuição de first-touch deixou de ser gravada
 * aqui — desde a B2.4 o cadastro não devolve sessão e a atribuição é gravada
 * em POST /api/auth/confirm (lib/auth/persist-attribution.ts).
 *
 * Etapa "B2.4 — Signup server-controlled": `signUp()` chama POST /api/auth/signup
 * (validação no servidor, fail-closed por `SIGNUP_ENABLED`); o navegador NUNCA
 * chama o GoTrue para criar conta (o signup público do Supabase fica
 * desabilitado). `signInWithPassword`/`requestPasswordReset` aceitam um
 * `captchaToken` opcional (repassado ao Supabase Auth) — preparação para o
 * Turnstile; sem token, o comportamento é idêntico ao anterior.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { isAuthWeakPasswordError } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AuthSession, AuthUser, SignUpInput, SignUpResult } from '@/features/auth/types'
import { mapAuthErrorMessage } from '@/features/auth/map-auth-error-message'

export interface AuthRepository {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Dispara quando o link de recuperação de senha é processado com sucesso. */
  onPasswordRecovery(callback: () => void): () => void
  signInWithGoogle(): Promise<void>
  signInWithPassword(email: string, password: string, captchaToken?: string): Promise<void>
  signUp(input: SignUpInput): Promise<SignUpResult>
  requestPasswordReset(email: string, captchaToken?: string): Promise<void>
  updatePassword(password: string): Promise<void>
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

    onPasswordRecovery(callback) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
        if (event === 'PASSWORD_RECOVERY') {
          callback()
        }
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

    async signInWithPassword(email, password, captchaToken) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      })

      // Investigação no código-fonte instalado (@supabase/auth-js, dentro
      // de @supabase/supabase-js) confirma: quando a senha está CORRETA
      // mas mais fraca que a política de senha atual do projeto (ex.:
      // conta antiga, criada antes de uma política mais forte existir),
      // o GoTrue autentica normalmente — `error` fica `null` e o aviso de
      // senha fraca vem à parte, em `data.weakPassword` (ver
      // GoTrueClient.signInWithPassword). Ou seja: o `if (error)` abaixo
      // já NUNCA bloqueia esse caso, mesmo sem este bloco.
      //
      // A checagem abaixo existe como segunda camada de segurança, caso o
      // Supabase um dia passe a anexar `error`/sessão juntos: nunca
      // bloqueia login com sessão real só por `weak_password`, mas
      // qualquer outro erro (`invalid_credentials`, `email_not_confirmed`,
      // rate limit etc.) continua lançado normalmente, sem exceção — só
      // este código de erro específico, e só quando uma sessão de verdade
      // já existe.
      if (error && isAuthWeakPasswordError(error) && data.session) {
        return
      }

      if (error) {
        throw new Error(mapAuthErrorMessage(error))
      }
    },

    async signUp(input) {
      // Etapa "B2.4": o cadastro NÃO chama o GoTrue do navegador (o signup
      // público do Supabase está desabilitado). A rota do servidor valida
      // flag, Origin, Turnstile, país (BR), consentimentos e versões, cria a
      // conta pendente pela Admin API e envia o e-mail de confirmação. O
      // usuário define a senha só depois de confirmar o e-mail.
      let response: Response
      try {
        response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      } catch {
        throw new Error('Não foi possível enviar o cadastro. Verifique sua conexão e tente novamente.')
      }

      const result = (await response.json().catch(() => null)) as { ok: true } | { ok: false; error?: string } | null

      if (!result || !result.ok) {
        throw new Error((result && !result.ok && result.error) || 'Não foi possível concluir o cadastro. Tente novamente.')
      }

      return { needsEmailConfirmation: true }
    },

    async requestPasswordReset(email, captchaToken) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
        ...(captchaToken ? { captchaToken } : {}),
      })
      if (error) {
        throw new Error(mapAuthErrorMessage(error))
      }
    },

    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        throw new Error(mapAuthErrorMessage(error))
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
