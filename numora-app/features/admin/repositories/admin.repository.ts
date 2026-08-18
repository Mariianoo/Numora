/**
 * features/admin/repositories/admin.repository.ts
 * Infrastructure layer do Admin Control Center (PROJECT_RULES.md §4.2) —
 * única camada que conhece os nomes das tabelas/RPCs administrativas.
 * Client de browser (Etapa 15.3, `/admin/members` é interativo — filtros e
 * paginação sem reload de página, mesmo padrão de Coleção).
 *
 * Toda leitura/escrita aqui já é protegida no banco (RLS + `is_platform_
 * admin()` dentro de cada RPC/policy) — este repositório não faz NENHUMA
 * checagem de role em código: se um usuário sem a role chamar qualquer
 * método daqui, o Postgres recusa (RPC lança 42501, ou a policy
 * simplesmente não retorna linhas). A UI nunca é a barreira de segurança,
 * só o banco.
 *
 * `/admin/page.tsx` e `/admin/audit/page.tsx` (Server Components,
 * somente-leitura, sem interação) NÃO passam por este repositório — chamam
 * o client de servidor diretamente, mesmo padrão já usado em
 * `app/dashboard/page.tsx`. Este repositório existe só para a superfície
 * que precisa de estado no client: listagem paginada/filtrada de membros e
 * as mutações de cortesia.
 *
 * `getOwnRole()` (Etapa 15.5): diferente dos demais métodos, não exige
 * nenhuma role administrativa — lê a PRÓPRIA `role` via a mesma policy
 * `profiles_select_own` que já permite a qualquer usuário ler sua própria
 * linha (usada por `requireAdmin()` no servidor). Existe para uma
 * necessidade puramente de UX: `app/dashboard/layout.tsx` (compartilhado
 * por TODO usuário autenticado, não só admins) precisa saber se mostra o
 * item "Painel Administrativo" na Sidebar/badge na Topbar. Nunca é a
 * barreira de segurança — `/admin/*` continua protegido só por
 * `requireAdmin()` (servidor) e `is_platform_admin()` (banco).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type {
  AdminMember,
  AdminMembersPage,
  AdminRole,
  BenefitGrant,
  GrantCourtesyInput,
  ListMembersParams,
} from '@/features/admin/types'

export interface AdminRepository {
  listMembers(params: ListMembersParams): Promise<AdminMembersPage>
  grantCourtesy(input: GrantCourtesyInput): Promise<BenefitGrant>
  /** Encontra e revoga a concessão ativa mais recente do usuário. Lança erro se não houver nenhuma. */
  revokeActiveCourtesy(userId: string): Promise<void>
  /** `null` quando não há sessão ou a role não pôde ser lida — chamador deve tratar como "sem privilégio administrativo". */
  getOwnRole(): Promise<AdminRole | null>
}

interface AdminListMembersRow {
  id: string
  numora_id: string
  email: string | null
  name: string | null
  username: string | null
  /** Etapa 15.9.1-R3: vem de effective_plans() dentro da RPC, não mais de profiles.plan_tier. */
  plan_slug: AdminMember['planSlug']
  role: AdminMember['role']
  passport_public: boolean
  created_at: string
  last_sign_in_at: string | null
  courtesy_active: boolean
  total_count: number
}

function toAdminMember(row: AdminListMembersRow): AdminMember {
  return {
    id: row.id,
    numoraId: row.numora_id,
    email: row.email,
    name: row.name,
    username: row.username,
    planSlug: row.plan_slug,
    role: row.role,
    passportPublic: row.passport_public,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    courtesyActive: row.courtesy_active,
  }
}

interface BenefitGrantRow {
  id: string
  user_id: string
  type: BenefitGrant['type']
  plan: string
  reason: string | null
  starts_at: string
  expires_at: string | null
  created_by: string
  created_at: string
  revoked_at: string | null
}

function toBenefitGrant(row: BenefitGrantRow): BenefitGrant {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    plan: row.plan,
    reason: row.reason,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

export function createSupabaseAdminRepository(): AdminRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listMembers({ limit = 50, offset = 0, planFilter = null, search = null }) {
      const { data, error } = await supabase.rpc('admin_list_members', {
        p_limit: limit,
        p_offset: offset,
        p_plan_filter: planFilter,
        p_search: search && search.trim() !== '' ? search.trim() : null,
      })

      if (error) {
        throw new Error(`[AdminRepository] Falha ao listar membros: ${error.message}`)
      }

      const rows = (data ?? []) as AdminListMembersRow[]

      return {
        members: rows.map(toAdminMember),
        totalCount: rows[0]?.total_count ?? 0,
      }
    },

    async grantCourtesy(input) {
      const { data, error } = await supabase
        .from('benefit_grants')
        .insert({
          user_id: input.userId,
          type: input.type,
          plan: input.plan,
          reason: input.reason,
          expires_at: input.expiresAt,
        })
        .select('*')
        .single()

      if (error) {
        throw new Error(`[AdminRepository] Falha ao conceder cortesia: ${error.message}`)
      }

      const grant = toBenefitGrant(data as BenefitGrantRow)

      const { error: logError } = await supabase.rpc('log_admin_action', {
        p_action: 'benefit_grant.create',
        p_target_user_id: input.userId,
        p_metadata: { grant_id: grant.id, type: input.type, plan: input.plan, expires_at: input.expiresAt },
      })

      if (logError) {
        throw new Error(`[AdminRepository] Cortesia concedida, mas falha ao registrar auditoria: ${logError.message}`)
      }

      return grant
    },

    async revokeActiveCourtesy(userId) {
      const { data: activeGrant, error: findError } = await supabase
        .from('benefit_grants')
        .select('id')
        .eq('user_id', userId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (findError) {
        throw new Error(`[AdminRepository] Falha ao localizar cortesia ativa: ${findError.message}`)
      }
      if (!activeGrant) {
        throw new Error('[AdminRepository] Nenhuma cortesia ativa encontrada para este usuário.')
      }

      const { error } = await supabase
        .from('benefit_grants')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', activeGrant.id)

      if (error) {
        throw new Error(`[AdminRepository] Falha ao revogar cortesia: ${error.message}`)
      }

      const { error: logError } = await supabase.rpc('log_admin_action', {
        p_action: 'benefit_grant.revoke',
        p_target_user_id: userId,
        p_metadata: { grant_id: activeGrant.id },
      })

      if (logError) {
        throw new Error(`[AdminRepository] Cortesia revogada, mas falha ao registrar auditoria: ${logError.message}`)
      }
    },

    async getOwnRole() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return null
      }

      const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

      if (error || !data) {
        return null
      }

      return data.role as AdminRole
    },
  }
}
