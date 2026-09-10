/**
 * lib/analytics/events/paywall-events.ts
 * Etapa "5.9E — Analytics" — eventos do funil de monetização
 * (limite→paywall→checkout). Mesmo padrão de lib/analytics/events/
 * product-events.ts (cada função só encapsula nome+propriedades e chama
 * `pushToDataLayer()`; QUANDO disparar é responsabilidade de quem chama).
 * Arquivo separado (em vez de estender product-events.ts) porque estes 5
 * eventos legitimamente precisam de propriedades — ao contrário dos 5
 * eventos de product-events.ts, que são `{}` por decisão deliberada da
 * Etapa 15.10.4.
 *
 * Nomes de propriedade em snake_case (`current_count`, `plan_slug`...) —
 * convenção do GA4/GTM para parâmetros de evento, e consistente com a
 * nomenclatura que o próprio pedido desta etapa já usa para
 * collection_limit_reached/feature_locked/upgrade_viewed.
 *
 * `plan_slug` NUNCA deve ser resolvido aqui por comparação de string
 * (`plan === 'pro'`) — é sempre um valor já resolvido por quem chama, a
 * partir de uma fonte de entitlement real (`check_collection_item_limit()`,
 * `get_effective_plan()`) — ver auditoria da Etapa 5.9E, "não duplicar
 * lógica de entitlement".
 *
 * `checkout_completed` (o 5º evento do funil) está DEFERRED — não existe
 * hoje nenhum transporte server-side de analytics no projeto (`pushToDataLayer`
 * é `'use client'`/`window.dataLayer`, inutilizável dentro do Route Handler
 * do webhook). Decisão explícita do OWNER: não introduzir GA4 Measurement
 * Protocol/novo secret/novo vendor nesta etapa — arquitetura de transporte
 * server-side + correlação client/server fica para uma etapa futura
 * dedicada. Ver app/api/stripe/webhook/route.ts para o ponto exato onde o
 * evento nasceria (action === 'process' && event.type === 'checkout.session.completed').
 */
'use client'

import { pushToDataLayer } from '@/lib/analytics/gtm'

/** Únicos contexts válidos — nunca inventar um novo sem atualizar este tipo e o relatório da etapa. */
export type CollectionLimitReachedContext = 'collection_page' | 'new_item' | 'restore'

export interface CollectionLimitReachedProperties {
  current_count: number
  limit: number
  plan_slug: string
  context: CollectionLimitReachedContext
}

/** Dispara quando um usuário Free efetivamente ATINGE o estado de limite — nunca em toda renderização da página. Dedup é responsabilidade do chamador. */
export function trackCollectionLimitReached(properties: CollectionLimitReachedProperties): void {
  pushToDataLayer({ event: 'collection_limit_reached', ...properties })
}

export interface FeatureLockedProperties {
  /** Ex.: 'labels', 'dashboard_advanced'. Não usado para o limite de collection_items — esse caso já tem evento dedicado (collection_limit_reached), para não duplicar o sinal de um mesmo momento do usuário. */
  feature_key: string
  plan_slug: string
  context: string
}

/** Dispara quando o usuário efetivamente ENCONTRA um bloqueio de feature Pro-only (estado "blocked"/"locked" já resolvido por entitlement real). */
export function trackFeatureLocked(properties: FeatureLockedProperties): void {
  pushToDataLayer({ event: 'feature_locked', ...properties })
}

/** Únicos triggers válidos — nunca inventar um novo sem atualizar este tipo. */
export type UpgradeViewedTrigger = 'collection_limit' | 'restore_limit' | 'dashboard' | 'labels' | 'future_feature'

export interface UpgradeViewedProperties {
  trigger: UpgradeViewedTrigger
  plan_slug: string
  /** Só quando aplicável (ex.: triggers de limite de coleção) — omitido para 'dashboard'/'labels'/'future_feature'. */
  current_count?: number
  limit?: number
}

/** Dispara quando o Paywall (UpgradeToProDialog) fica de fato visível — uma abertura real = um evento, nunca por render/remount sem nova abertura. */
export function trackUpgradeViewed(properties: UpgradeViewedProperties): void {
  const event: Record<string, unknown> = { event: 'upgrade_viewed', trigger: properties.trigger, plan_slug: properties.plan_slug }
  if (properties.current_count !== undefined) event.current_count = properties.current_count
  if (properties.limit !== undefined) event.limit = properties.limit
  pushToDataLayer(event)
}

export interface CheckoutStartedProperties {
  plan_slug: string
  interval: string
  currency: string
  /**
   * Etapa "5.9G — First-Party Analytics Outbox" — UUID gerado pelo
   * servidor (nunca pelo client), devolvido pela resposta de
   * `/api/billing/checkout` (`funnelId`). É o ÚNICO identificador de
   * correlação aceito aqui — nunca o Stripe Checkout Session ID
   * (`sessionId`, também presente na resposta, mas propositalmente nunca
   * usado por este evento), nunca `user_id`, nunca nenhum Stripe ID.
   */
  funnel_id: string
}

/** Dispara SÓ depois de POST /api/billing/checkout responder com sucesso e uma url válida — nunca no clique bruto. Propriedades sempre derivadas do mesmo valor já enviado no request/devolvido pela resposta, nunca de input do usuário. */
export function trackCheckoutStarted(properties: CheckoutStartedProperties): void {
  pushToDataLayer({ event: 'checkout_started', ...properties })
}
