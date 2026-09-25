/**
 * lib/billing/plan-availability.ts
 * Etapa "Official Launch Foundation — Bloco A" — fonte ÚNICA de verdade de
 * "quais planos podem ser contratados hoje". Módulo puro (sem I/O, sem
 * imports do projeto), usável tanto no servidor (Route Handlers, lib/stripe)
 * quanto na UI (PricingSelector, UpgradeToProDialog) — nunca duas listas
 * paralelas que possam divergir.
 *
 * Decisão de produto (D1/D2): Premium NÃO é vendido enquanto não tiver
 * diferenciação real — hoje seus entitlements são idênticos aos do Pro.
 * Por isso a venda NUNCA pode depender só de `plan_prices.active` (um preço
 * ativo no catálogo bastaria para abrir Checkout/troca de plano): esta lista
 * é uma barreira independente, aplicada no servidor
 * (`/api/billing/checkout`, `/api/billing/subscription/change-plan`,
 * `changeOwnPlan`) e refletida na UI só como conveniência.
 *
 * Liberar o Premium no futuro é uma decisão explícita e revisável: mover
 * `'premium'` de `COMING_SOON_PLAN_SLUGS` para `PURCHASABLE_PLAN_SLUGS`, com
 * o produto diferenciado — nunca ativar um preço e esperar que isso baste.
 *
 * Fail-closed: qualquer slug desconhecido (incluindo `'free'`, que não tem
 * Checkout) é NÃO comprável.
 */

/** Planos que podem ser contratados hoje (Checkout e troca de plano de destino). */
export const PURCHASABLE_PLAN_SLUGS = ['pro'] as const

/** Planos visíveis como "Em breve": sem Checkout, sem troca de plano, só `plan_interest`. */
export const COMING_SOON_PLAN_SLUGS = ['premium'] as const

export type PurchasablePlanSlug = (typeof PURCHASABLE_PLAN_SLUGS)[number]
export type ComingSoonPlanSlug = (typeof COMING_SOON_PLAN_SLUGS)[number]

/** Mensagem única e neutra para qualquer tentativa de contratar um plano indisponível — nunca revela detalhe interno (catálogo, Stripe, ambiente). */
export const PLAN_UNAVAILABLE_MESSAGE = 'Este plano ainda não está disponível para contratação.'

export function isPlanPurchasable(planSlug: string): boolean {
  return (PURCHASABLE_PLAN_SLUGS as readonly string[]).includes(planSlug)
}

export function isPlanComingSoon(planSlug: string): boolean {
  return (COMING_SOON_PLAN_SLUGS as readonly string[]).includes(planSlug)
}
