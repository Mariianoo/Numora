/**
 * lib/stripe/resolve-currency.ts
 * Etapa "5.10D — Billing Commercial Foundation" — decisão comercial de
 * moeda: `country_code === 'BR'` vende em BRL, qualquer outro valor
 * (incluindo `null`, país não informado) vende em USD. Função pura, sem
 * I/O — nunca geolocalização por IP/browser, nunca consulta externa.
 *
 * `country_code` sempre vem de `profiles.country_code` (residência
 * informada no Cadastro/Perfil, já existente) — nunca de um header/IP da
 * requisição. Esta função nunca é a autoridade final de preço: o servidor
 * (`resolveSellablePrice`, `/api/billing/checkout`) sempre revalida a
 * combinação plan+interval+currency contra o catálogo real antes de criar
 * qualquer Checkout Session.
 */
import type { PriceCurrency } from './catalog'

export function resolveCurrencyFromCountryCode(countryCode: string | null): PriceCurrency {
  return countryCode === 'BR' ? 'BRL' : 'USD'
}
