/**
 * lib/analytics/events/product-events.ts
 * Etapa 15.10.4 — primeira camada de eventos de produto client-side.
 *
 * Cada função encapsula só o nome do evento e chama `pushToDataLayer()`
 * (lib/analytics/gtm.ts) — nenhuma delas acessa Supabase, contém regra de
 * negócio, ou decide QUANDO disparar; isso é responsabilidade de quem
 * importa (componente de página ou repository). Nenhum parâmetro é aceito
 * de propósito: os 5 eventos desta etapa têm contrato `{}` (ver relatório
 * Etapa 15.10.4 §9) — sem parâmetro, não há como acidentalmente vazar PII,
 * dado financeiro ou dado de coleção por aqui.
 *
 * `pushToDataLayer()` já é no-op sem `consent.analytics` — estas funções
 * não duplicam essa checagem.
 */
'use client'

import { pushToDataLayer } from '@/lib/analytics/gtm'

export function trackLandingView(): void {
  pushToDataLayer({ event: 'landing_view' })
}

export function trackDashboardView(): void {
  pushToDataLayer({ event: 'dashboard_view' })
}

export function trackCollectionViewed(): void {
  pushToDataLayer({ event: 'collection_viewed' })
}

/** Item de produto criado com sucesso — dispara toda vez, inclusive a partir do 2º item em diante. */
export function trackItemAdded(): void {
  pushToDataLayer({ event: 'item_added' })
}

/**
 * Ativação oficial (decisão do OWNER, Etapa 15.10.4) — só deve ser chamada
 * quando o CHAMADOR já determinou, a partir do banco, que este é o
 * primeiro item que o usuário já criou. Esta função não faz essa
 * verificação — ela só encapsula o nome do evento, como as demais.
 */
export function trackFirstItemAdded(): void {
  pushToDataLayer({ event: 'first_item_added' })
}
