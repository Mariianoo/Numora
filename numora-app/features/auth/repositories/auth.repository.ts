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
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AuthSession, AuthUser, SignUpInput, SignUpResult } from '@/features/auth/types'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'

export interface AuthRepository {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Dispara quando o link de recuperação de senha é processado com sucesso. */
  onPasswordRecovery(callback: () => void): () => void
  signInWithGoogle(): Promise<void>
  signInWithPassword(email: string, password: string): Promise<void>
  signUp(input: SignUpInput): Promise<SignUpResult>
  requestPasswordReset(email: string): Promise<void>
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

/**
 * Traduz os códigos de erro conhecidos do Supabase Auth (`error.code`,
 * estável — nunca `error.message`, que é texto em inglês sujeito a
 * mudar) para mensagens em português. Propositalmente NÃO diferencia
 * "e-mail não existe" de "senha errada": o próprio Supabase retorna o
 * mesmo `invalid_credentials` para os dois casos, por segurança contra
 * enumeração de contas — não tentamos ser mais específicos que isso.
 */
function mapAuthErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.'
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com este e-mail.'
    case 'weak_password':
      return 'Senha muito fraca. Use pelo menos 8 caracteres.'
    case 'same_password':
      return 'A nova senha precisa ser diferente da atual.'
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
    default:
      // Código não mapeado (ex.: erro de rede antes de chegar ao Supabase,
      // ou algum código novo do SDK) — nunca mostramos error.message bruto
      // direto; o fallback preserva o texto original só quando ele já é
      // seguro (ver getUserFriendlyErrorMessage).
      return getUserFriendlyErrorMessage(new Error(error.message), error.message)
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

    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        throw new Error(mapAuthErrorMessage(error))
      }
    },

    async signUp(input) {
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: {
            name: input.name,
            country_code: input.countryCode,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        throw new Error(mapAuthErrorMessage(error))
      }

      const hasSession = data.session !== null

      // Se "Confirm email" estivesse desabilitado, já haveria sessão ativa
      // aqui e o usuário nunca passaria por app/auth/callback/route.ts
      // (que é quem aplica country_code a partir do metadata na
      // confirmação). Cobrimos os dois cenários gravando diretamente
      // enquanto a sessão está disponível — sem duplicar a criação do
      // profile em si, que continua exclusivamente a cargo do trigger.
      if (hasSession && input.countryCode && data.user) {
        await supabase.from('profiles').update({ country_code: input.countryCode }).eq('id', data.user.id)
      }

      return { hasSession }
    },

    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
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
