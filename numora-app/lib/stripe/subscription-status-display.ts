/**
 * lib/stripe/subscription-status-display.ts
 * Etapa "Admin Subscriptions V1" — rótulo/tom de badge para
 * `subscriptions.status` (8 valores reais do CHECK constraint, ver
 * migration `create_subscriptions`). Mesmo espírito de
 * `lib/plans/plan-display.ts` (que formata `plan_slug`, nunca status) —
 * nunca decide o que é "ativo"/"cancelando"; isso é responsabilidade do
 * banco (`admin_subscriptions_summary()`), este arquivo só formata um
 * status já resolvido.
 */
import type { BadgeTone } from '@/components/ui/Badge'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'paused'

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Em trial',
  active: 'Ativa',
  past_due: 'Pagamento atrasado',
  canceled: 'Cancelada',
  incomplete: 'Incompleta',
  incomplete_expired: 'Incompleta (expirada)',
  unpaid: 'Não paga',
  paused: 'Pausada',
}

const STATUS_BADGE_TONES: Record<SubscriptionStatus, BadgeTone> = {
  trialing: 'accent',
  active: 'success',
  past_due: 'danger',
  canceled: 'neutral',
  incomplete: 'danger',
  incomplete_expired: 'neutral',
  unpaid: 'danger',
  paused: 'neutral',
}

export function subscriptionStatusLabel(status: string): string {
  return STATUS_LABELS[status as SubscriptionStatus] ?? status
}

export function subscriptionStatusBadgeTone(status: string): BadgeTone {
  return STATUS_BADGE_TONES[status as SubscriptionStatus] ?? 'neutral'
}

export function subscriptionIntervalLabel(interval: string | null): string {
  if (interval === 'month') return 'Mensal'
  if (interval === 'year') return 'Anual'
  return '—'
}
