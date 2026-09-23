/**
 * features/admin/repositories/admin-alerts.repository.ts
 * Etapa "Admin Alerts V1" — auditoria "ADMIN ALERTS V1 — AUDIT REPORT"
 * (Categoria A): só os 2 alertas com dado real e regra objetiva hoje.
 * Client de browser, mesmo padrão de `features/admin/repositories/
 * admin.repository.ts`/`features/billing/repositories/admin-transactions.repository.ts`.
 *
 * SEM RPC nova de propósito: `benefit_grants_select_admin` (RLS,
 * `is_platform_admin()`) já é a barreira real para `listExpiringBenefitGrants()`.
 * Nunca uma checagem de role em código — se um usuário sem a role chamar
 * isto, a policy simplesmente não retorna linhas.
 *
 * `isCriticalUnresolvedFeedback()` é a regra pura do segundo alerta — vive
 * aqui (não em `features/feedback/repositories/feedback-admin.repository.ts`)
 * porque é uma regra do DOMÍNIO DE ALERTAS, não do domínio de feedback em
 * si; a leitura em si reutiliza `FeedbackAdminRepository.list()` já
 * existente (nenhuma query/embed duplicado — `/admin/alerts` filtra em
 * memória sobre o mesmo resultado que `/admin/feedback` já sabe buscar).
 *
 * Regras EXATAS da auditoria, nunca alteradas aqui:
 *   1. Cortesia expirando: `revoked_at IS NULL AND expires_at BETWEEN now()
 *      AND now() + interval '7 days'`.
 *   2. Feedback crítico: `priority = 'critical' AND status NOT IN
 *      ('completed', 'dismissed')`.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AdminExpiringBenefitGrant, BenefitGrant } from '@/features/admin/types'
import type { AdminFeedback } from '@/features/feedback/types'

export interface AdminAlertsRepository {
  /** `revoked_at IS NULL AND expires_at BETWEEN now() AND now() + 7 dias`, ordenado pela expiração mais próxima primeiro. */
  listExpiringBenefitGrants(): Promise<AdminExpiringBenefitGrant[]>
}

interface ExpiringBenefitGrantRow {
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
  profiles: { name: string | null; email: string | null } | null
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function toAdminExpiringBenefitGrant(row: ExpiringBenefitGrantRow): AdminExpiringBenefitGrant {
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
    userName: row.profiles?.name ?? null,
    userEmail: row.profiles?.email ?? null,
  }
}

export function createSupabaseAdminAlertsRepository(): AdminAlertsRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listExpiringBenefitGrants() {
      const now = new Date()
      const in7Days = new Date(now.getTime() + SEVEN_DAYS_MS)

      const { data, error } = await supabase
        .from('benefit_grants')
        .select('id, user_id, type, plan, reason, starts_at, expires_at, created_by, created_at, revoked_at, profiles(name, email)')
        .is('revoked_at', null)
        .gte('expires_at', now.toISOString())
        .lte('expires_at', in7Days.toISOString())
        .order('expires_at', { ascending: true })

      if (error) {
        throw new Error(`[AdminAlertsRepository] Falha ao listar cortesias expirando: ${error.message}`)
      }

      const rows = (data ?? []) as unknown as ExpiringBenefitGrantRow[]
      return rows.map(toAdminExpiringBenefitGrant)
    },
  }
}

/**
 * Regra pura do alerta "Feedback crítico não resolvido" — nunca reimplementa
 * o que já vem de `FeedbackAdminRepository.list()`, só decide quais linhas
 * do resultado já existente pertencem a este alerta.
 */
export function isCriticalUnresolvedFeedback(feedback: Pick<AdminFeedback, 'priority' | 'status'>): boolean {
  return feedback.priority === 'critical' && feedback.status !== 'completed' && feedback.status !== 'dismissed'
}
