/**
 * lib/format/currency.ts
 * Etapa "5.10D — Billing Commercial Foundation" — formatação de preços do
 * catálogo comercial (`plan_prices.amount`, sempre em unidade inteira, ex.:
 * 19.90 — nunca minor units aqui, ver `lib/stripe/minor-units.ts` para essa
 * conversão, usada só na fronteira com a API do Stripe). Função pura, sem
 * I/O — nunca formata um valor que não veio do catálogo real.
 */
import type { PriceCurrency } from '@/lib/stripe/catalog'

const LOCALE_BY_CURRENCY: Record<PriceCurrency, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
}

export function formatPrice(amount: number, currency: PriceCurrency): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: 'currency',
    currency,
  }).format(amount)
}
