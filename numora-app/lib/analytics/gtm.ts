/**
 * lib/analytics/gtm.ts
 * Etapa 15.10.1 — único ponto do projeto que escreve em `window.dataLayer`.
 *
 * Etapa 15.10.4: primeiro consumidor real (`lib/analytics/events/
 * product-events.ts`). Gate de `consent.analytics` centralizado AQUI (não
 * duplicado em cada helper de evento) — sem consentimento, `pushToDataLayer`
 * é no-op total: nenhum evento de produto chega a `window.dataLayer`, então
 * nenhum GTM carregado (mesmo se algum dia carregasse sem consentimento)
 * teria o que ler. `getConsent()` é síncrono (lê localStorage direto, sem
 * hook) — apropriado aqui porque cada chamada é um push pontual, não um
 * componente que precisa reagir a mudança de consentimento em tempo real.
 *
 * NUNCA passe PII (nome, e-mail, valores financeiros, IDs internos do
 * Supabase, dados privados da coleção) para `event` — ver auditoria da
 * Etapa 15.10 §5. Este helper não valida o conteúdo (não há como validar
 * "é PII?" genericamente) — a responsabilidade é de quem chama, em cada
 * evento.
 */
'use client'

import { getConsent } from './consent'

declare global {
  interface Window {
    dataLayer?: unknown[]
  }
}

export function pushToDataLayer(event: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (!getConsent().analytics) return

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(event)
}
