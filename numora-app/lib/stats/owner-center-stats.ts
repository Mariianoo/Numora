/**
 * lib/stats/owner-center-stats.ts
 * Cálculos puros do OWNER CENTER (Etapa 15.9.1) — sem dependência de
 * Supabase, mesmo espírito de lib/stats/collection-stats.ts: quem busca os
 * dados (app/admin/page.tsx, Server Component) decide a origem, estas
 * funções só transformam os arrays já carregados.
 *
 * Etapa 15.9.1-R2: `computePlanDistribution()` (que reimplementava em
 * TypeScript a prioridade courtesy > subscription > free) foi REMOVIDA —
 * essa prioridade agora tem uma única definição, em SQL, em
 * `effective_plans()`/`admin_plan_distribution()` (banco). `mapPlanDistribution`
 * abaixo não decide nenhuma regra comercial: só formata o resultado já
 * pronto da RPC contra o catálogo de planos, para preservar o mesmo
 * comportamento visual de zero-fill (Free/Pro/Premium sempre visíveis,
 * mesmo com contagem 0) que a versão anterior tinha.
 */
import type { DistributionEntry, MonthlyAcquisitionEntry } from './collection-stats'
import { formatMonthKeyLabel, shiftMonthKey } from './collection-stats'

export interface OwnerCenterPlanRow {
  id: string
  slug: string
  name: string
  active: boolean
}

/** 1 linha por plano com >= 1 membro — retorno de admin_plan_distribution() (banco). */
export interface OwnerCenterPlanDistributionRow {
  plan_slug: string
  member_count: number
}

/**
 * Mapeia o resultado de `admin_plan_distribution()` (já com a prioridade
 * courtesy > subscription > free resolvida em SQL) contra o catálogo de
 * planos — só formatação/zero-fill, nenhuma regra comercial aqui. Sempre
 * inclui os 3 planos do catálogo (mesmo com contagem 0), diferente de
 * `computeStatusDistribution`/`computeGradeDistribution` (collection-stats.ts),
 * que omitem valores ausentes: aqui o conjunto de planos é pequeno e fixo,
 * e comparar os 3 lado a lado é o propósito do card (Etapa 15.9.1 §5).
 */
export function mapPlanDistribution(
  plans: OwnerCenterPlanRow[],
  distribution: OwnerCenterPlanDistributionRow[],
): DistributionEntry[] {
  const countBySlug = new Map(distribution.map((row) => [row.plan_slug, Number(row.member_count)]))

  return plans.map((plan) => ({
    key: plan.slug,
    label: plan.name,
    count: countBySlug.get(plan.slug) ?? 0,
  }))
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Ativa',
  past_due: 'Pagamento atrasado',
  canceled: 'Cancelada',
  incomplete: 'Incompleta',
  incomplete_expired: 'Expirada (incompleta)',
  unpaid: 'Não paga',
  paused: 'Pausada',
}

/** Só inclui status realmente presentes — mesmo critério de computeStatusDistribution (collection-stats.ts). */
export function computeSubscriptionStatusDistribution(
  subscriptions: { status: string }[],
): DistributionEntry[] {
  const counts = new Map<string, number>()
  for (const sub of subscriptions) {
    counts.set(sub.status, (counts.get(sub.status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ key: status, label: SUBSCRIPTION_STATUS_LABELS[status] ?? status, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Crescimento mensal de membros (novos cadastros por mês), janela de
 * `monthsWindow` meses terminando no mês atual — mesmo formato/janela de
 * `computeMonthlyAcquisitionValue` (collection-stats.ts), aplicado a
 * `profiles.created_at` em vez de `purchases`. Nunca preenche meses sem
 * cadastro.
 */
export function computeMemberGrowth(createdAtValues: string[], monthsWindow = 12): MonthlyAcquisitionEntry[] {
  const windowStartKey = shiftMonthKey(new Date(), -(monthsWindow - 1))

  const totals = new Map<string, number>()
  for (const createdAt of createdAtValues) {
    const monthKey = createdAt.slice(0, 7)
    if (monthKey < windowStartKey) continue
    totals.set(monthKey, (totals.get(monthKey) ?? 0) + 1)
  }

  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, label: formatMonthKeyLabel(key), value }))
}
