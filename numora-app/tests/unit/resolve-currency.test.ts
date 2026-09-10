/**
 * tests/unit/resolve-currency.test.ts
 * Etapa "5.10D — Billing Commercial Foundation" — `resolveCurrencyFromCountryCode`.
 */
import { describe, expect, it } from 'vitest'

import { resolveCurrencyFromCountryCode } from '@/lib/stripe/resolve-currency'

describe('resolveCurrencyFromCountryCode', () => {
  it("'BR' → 'BRL'", () => {
    expect(resolveCurrencyFromCountryCode('BR')).toBe('BRL')
  })

  it.each(['US', 'PT', 'AR', 'JP'])("'%s' (não-BR) → 'USD'", (code) => {
    expect(resolveCurrencyFromCountryCode(code)).toBe('USD')
  })

  it("null (país não informado) → 'USD'", () => {
    expect(resolveCurrencyFromCountryCode(null)).toBe('USD')
  })

  it("string vazia → 'USD'", () => {
    expect(resolveCurrencyFromCountryCode('')).toBe('USD')
  })

  it("'br' minúsculo NÃO é tratado como 'BR' — comparação estrita, nunca normaliza case", () => {
    expect(resolveCurrencyFromCountryCode('br')).toBe('USD')
  })
})
