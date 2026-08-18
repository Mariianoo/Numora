/**
 * features/admin/types.ts
 * Tipagens de domínio do Admin Control Center (Etapa 15.3).
 *
 * `AdminRole` reflete o CHECK real de `profiles.role` (migration
 * `extend_profiles_role_admin_helper`) — nesta etapa só 'owner'/'admin'
 * concedem acesso administrativo (`is_platform_admin()` no banco);
 * 'support'/'finance' já são valores válidos, reservados para granularidade
 * futura, tratados como "sem acesso" por enquanto.
 */

export type AdminRole = 'user' | 'seller' | 'admin' | 'owner' | 'support' | 'finance'

/**
 * Etapa 15.9.1-R3: substitui o antigo `PlanTier` ('free'|'premium', preso
 * ao binário de `profiles.plan_tier`). Agora reflete o slug real de
 * `plans` (free/pro/premium) — o mesmo valor que `effective_plans()`
 * (Etapa 15.9.1-R2) resolve, nunca inventado aqui.
 */
export type PlanSlug = 'free' | 'pro' | 'premium'

/**
 * Métricas agregadas de `admin_dashboard_metrics()` — todas reais,
 * derivadas do banco. Nenhum campo de receita/assinatura: Stripe não está
 * configurado nesta etapa (ver `AdminDashboardMetrics` sem `revenue`).
 */
export interface AdminDashboardMetrics {
  totalMembers: number
  /** last_sign_in_at (auth.users) nos últimos 30 dias — única definição de "ativo" usada no app. */
  activeMembers30d: number
  freeMembers: number
  premiumMembers: number
  /** benefit_grants vigentes (não revogados, dentro do período de validade). */
  courtesyActive: number
  coinsCount: number
  unitsCount: number
  purchasesCount: number
  passportsPublished: number
  imagesStored: number
}

export interface AdminMember {
  id: string
  numoraId: string
  email: string | null
  name: string | null
  username: string | null
  /** Plano EFETIVO (Etapa 15.9.1-R3) — vem de `effective_plans()` via `admin_list_members()`, nunca de `profiles.plan_tier`. */
  planSlug: PlanSlug
  role: AdminRole
  passportPublic: boolean
  createdAt: string
  /** `null` quando o usuário nunca fez login (ex.: cadastro pendente de confirmação de e-mail). */
  lastSignInAt: string | null
  courtesyActive: boolean
}

export interface AdminMembersPage {
  members: AdminMember[]
  totalCount: number
}

export interface ListMembersParams {
  limit?: number
  offset?: number
  planFilter?: PlanSlug | null
  search?: string | null
}

export type BenefitType = 'trial' | 'courtesy' | 'partnership' | 'beta' | 'admin'

export interface GrantCourtesyInput {
  userId: string
  type: BenefitType
  /** slug de `plans` (ex.: 'pro', 'premium'). */
  plan: string
  reason: string | null
  /** `null` = sem expiração automática. */
  expiresAt: string | null
}

export interface BenefitGrant {
  id: string
  userId: string
  type: BenefitType
  plan: string
  reason: string | null
  startsAt: string
  expiresAt: string | null
  createdBy: string
  createdAt: string
  revokedAt: string | null
}

export interface AuditLogEntry {
  id: string
  actorUserId: string
  actorName: string | null
  actorEmail: string | null
  action: string
  targetUserId: string | null
  targetName: string | null
  targetEmail: string | null
  metadata: Record<string, unknown>
  createdAt: string
}
