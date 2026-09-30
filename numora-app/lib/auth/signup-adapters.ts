/**
 * lib/auth/signup-adapters.ts
 * Etapa "B2.4 — Signup server-controlled" + "B2.4.1 — Hardening de ownership"
 * — implementação REAL das portas do handler de cadastro sobre a Admin API do
 * Supabase. SÓ servidor: recebe uma fábrica do client `service_role` (lazy — o
 * client só é criado se o fluxo realmente chegar a precisar dele).
 *
 * - `createPendingUser` usa `admin.createUser` (atômico pelo índice único do
 *   banco: um único vencedor) e grava o marcador/nonce em `app_metadata`
 *   (server-only), NUNCA em `user_metadata` (que o próprio usuário logado
 *   edita e que o `generateLink` sobrescreve).
 * - `findAuthUserIdByEmail` consulta `auth.users` por RPC (nunca `profiles`).
 * - `generateSignupLink` só devolve o `hashed_token` (para o link do e-mail);
 *   `action_link`/`email_otp` nunca saem daqui.
 *
 * NUNCA registra/retorna: senha, nonce, `hashed_token` em log, `action_link`,
 * e-mail ou mensagens cruas do Supabase.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { AuthUserInfo, CreatePendingResult, GenerateLinkResult, SignupAdminPort, SignupState } from '@/lib/auth/signup-handler'

const PUBLIC_FLOW_MARKER = 'public_v1'

export function readOwnership(appMetadata: Record<string, unknown> | null | undefined): {
  ownedByPublicFlow: boolean
  attemptNonce: string | null
  state: SignupState | null
} {
  const flow = appMetadata?.signup_flow
  const nonce = appMetadata?.signup_attempt_nonce
  const state = appMetadata?.signup_state
  const attemptNonce = typeof nonce === 'string' && nonce !== '' ? nonce : null

  return {
    ownedByPublicFlow: flow === PUBLIC_FLOW_MARKER && attemptNonce !== null,
    attemptNonce,
    state: state === 'provisioning' || state === 'ready' ? state : null,
  }
}

export function createSignupAdminPort(getAdmin: () => SupabaseClient): SignupAdminPort {
  return {
    async createPendingUser({ email, password, userMetadata, appMetadata }): Promise<CreatePendingResult> {
      const { data, error } = await getAdmin().auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: userMetadata,
        app_metadata: appMetadata,
      })

      if (error || !data.user) {
        const code = (error as { code?: string } | null)?.code
        return { ok: false, reason: code === 'email_exists' || code === 'user_already_exists' ? 'email_exists' : 'failed' }
      }
      return { ok: true, userId: data.user.id, createdAt: data.user.created_at ?? null }
    },

    async findAuthUserIdByEmail(email) {
      const { data, error } = await getAdmin().rpc('get_auth_user_id_by_email', { p_email: email })
      if (error) throw new Error('Falha ao consultar o cadastro existente.')
      return typeof data === 'string' && data !== '' ? data : null
    },

    async getUser(userId): Promise<AuthUserInfo | null> {
      const { data, error } = await getAdmin().auth.admin.getUserById(userId)
      if (error) {
        if (error.status === 404) return null
        throw new Error('Falha ao consultar o usuário.')
      }
      const user = data.user
      if (!user) return null

      return {
        id: user.id,
        confirmed: Boolean(user.email_confirmed_at),
        createdAt: user.created_at ?? null,
        confirmationSentAt: user.confirmation_sent_at ?? null,
        ...readOwnership(user.app_metadata),
      }
    },

    async generateSignupLink({ email, password, data, redirectTo }): Promise<GenerateLinkResult> {
      const { data: result, error } = await getAdmin().auth.admin.generateLink({
        type: 'signup',
        email,
        password,
        options: { ...(data ? { data } : {}), redirectTo },
      })

      if (error) {
        return { ok: false, reason: error.code === 'email_exists' || error.code === 'user_already_exists' ? 'email_exists' : 'failed' }
      }

      const tokenHash = result?.properties?.hashed_token
      const userId = result?.user?.id
      if (!tokenHash || !userId || result.properties.verification_type !== 'signup') {
        return { ok: false, reason: 'failed' }
      }

      return { ok: true, userId, tokenHash }
    },

    async markReady(userId) {
      // `app_metadata` é mesclada pelo GoTrue (provado): marcador e nonce permanecem.
      const { error } = await getAdmin().auth.admin.updateUserById(userId, { app_metadata: { signup_state: 'ready' } })
      if (error) throw new Error('Falha ao concluir o cadastro.')
    },

    async deleteUser(userId) {
      const { error } = await getAdmin().auth.admin.deleteUser(userId)
      if (error) throw new Error('Falha ao remover a conta.')
    },
  }
}
