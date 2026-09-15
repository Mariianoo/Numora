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
 * Etapa "5.10S — Pro Interest": `upgrade_interest_registered` é um evento
 * PARALELO a `checkout_started`, nunca um substituto — dispara quando o
 * usuário confirma "Quero ser avisado" no `UpgradeToProDialog` SEM iniciar
 * Checkout. Só deve ser chamado DEPOIS que o INSERT em `plan_interest`
 * (features/billing/repositories/plan-interest.repository.ts) resolver
 * com sucesso — nunca no clique bruto, nunca quando o INSERT falha (mesmo
 * contrato de "só depois de confirmado" já usado por `checkout_started`).
 *
 * `checkout_completed` (o 5º evento do funil original) está DEFERRED — não existe
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

/**
 * Únicos triggers válidos — nunca inventar um novo sem atualizar este tipo.
 * `pricing_page` (Etapa "5.10D — Billing Commercial Foundation"): abertura
 * do Checkout a partir da nova página de seleção de plano (`PricingSelector`)
 * — distinto de `future_feature`, que continua reservado para gates de
 * feature ainda não específicos. `export` (Etapa "5.10U — Exportação da
 * Coleção"): clique em "Exportar coleção" na Collection com o entitlement
 * `exports` desabilitado (Free).
 */
export type UpgradeViewedTrigger = 'collection_limit' | 'restore_limit' | 'dashboard' | 'labels' | 'future_feature' | 'pricing_page' | 'export'

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

export interface UpgradeInterestRegisteredProperties {
  /** Mesmo `UpgradeViewedTrigger` de `upgrade_viewed`/`checkout_started` — nunca uma taxonomia paralela. */
  trigger: UpgradeViewedTrigger
  plan_slug: string
  /** Só quando já disponível pelo caller (mesma fonte de `checkout_started`) — omitido quando não aplicável. */
  currency?: string
}

/** Dispara SÓ depois que o INSERT em `plan_interest` for confirmado pelo banco — nunca no clique bruto, nunca quando o INSERT falha. Nunca inicia Checkout, nunca chama Stripe. */
export function trackUpgradeInterestRegistered(properties: UpgradeInterestRegisteredProperties): void {
  const event: Record<string, unknown> = { event: 'upgrade_interest_registered', trigger: properties.trigger, plan_slug: properties.plan_slug }
  if (properties.currency !== undefined) event.currency = properties.currency
  pushToDataLayer(event)
}

export interface ExportCompletedProperties {
  plan_slug: string
  /** `'xlsx'` ainda não existe nesta etapa (ver auditoria 5.10T/5.10U — SheetJS avaliado e não adotado por ora) — união já preparada para não exigir mudança de contrato quando/se for implementado. */
  format: 'csv'
}

/**
 * Etapa "5.10U — Exportação da Coleção" — dispara SÓ depois que o entitlement
 * `exports` permitiu E o `Blob` do arquivo foi gerado com sucesso E o
 * download foi iniciado pela aplicação — nunca no clique bruto, nunca
 * quando a geração falha, nunca para um usuário Free bloqueado (esse caso
 * já é coberto por `feature_locked`/`upgrade_viewed`, nunca duplicado
 * aqui). Nunca usa `analytics_outbox` — mesmo transporte client-side
 * (`pushToDataLayer`) de todo evento deste arquivo.
 */
export function trackExportCompleted(properties: ExportCompletedProperties): void {
  pushToDataLayer({ event: 'export_completed', plan_slug: properties.plan_slug, format: properties.format })
}
