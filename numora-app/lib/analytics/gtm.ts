/**
 * lib/analytics/gtm.ts
 * Etapa 15.10.1 — único ponto do projeto que escreve em `window.dataLayer`.
 *
 * `pushToDataLayer()` não é chamada por nenhum evento de produto ainda
 * (isso é a Etapa 15.10.3) — existe aqui só como a infraestrutura pronta,
 * para que eventos futuros nunca escrevam em `window.dataLayer` diretamente
 * em vários lugares do código. No-op seguro em SSR (`typeof window`) e
 * quando o GTM não está carregado (o array só existe de verdade depois do
 * loader do GTM rodar — `window.dataLayer = window.dataLayer || []`
 * garante que o push nunca lança erro mesmo antes disso).
 *
 * NUNCA passe PII (nome, e-mail, valores financeiros, IDs internos do
 * Supabase, dados privados da coleção) para `event` — ver auditoria da
 * Etapa 15.10 §5. Este helper não valida o conteúdo (não há como validar
 * "é PII?" genericamente) — a responsabilidade é de quem chama, em cada
 * evento que a Etapa 15.10.3 vier a criar.
 */
'use client'

declare global {
  interface Window {
    dataLayer?: unknown[]
  }
}

export function pushToDataLayer(event: Record<string, unknown>): void {
  if (typeof window === 'undefined') return

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(event)
}
