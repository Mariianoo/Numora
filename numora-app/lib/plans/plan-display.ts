/**
 * lib/plans/plan-display.ts
 * Etapa 15.9.1-R3 — formatação (rótulo/tom de badge) do plano efetivo, para
 * evitar duplicar o mapeamento slug→label em /dashboard/profile e
 * /admin/members. NUNCA decide qual é o plano efetivo de ninguém — isso é
 * sempre resolvido no banco por `effective_plans()`/`get_effective_plan()`
 * (Etapa 15.9.1-R2); este arquivo só sabe formatar um slug já resolvido.
 */
import type { BadgeTone } from '@/components/ui/Badge'

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  premium: 'Premium',
}

const PLAN_BADGE_TONES: Record<string, BadgeTone> = {
  free: 'neutral',
  pro: 'accent',
  premium: 'success',
}

export function planLabel(slug: string): string {
  return PLAN_LABELS[slug] ?? slug
}

export function planBadgeTone(slug: string): BadgeTone {
  return PLAN_BADGE_TONES[slug] ?? 'neutral'
}

export type EffectivePlanSource = 'default' | 'subscription' | 'courtesy'

const PLAN_SOURCE_LABELS: Record<EffectivePlanSource, string> = {
  default: 'Padrão',
  subscription: 'Assinatura',
  courtesy: 'Cortesia',
}

/** `null` para 'default' de propósito — a UI não deve rotular o caso comum ("sem origem especial"). */
export function planSourceLabel(source: EffectivePlanSource): string | null {
  return source === 'default' ? null : PLAN_SOURCE_LABELS[source]
}
