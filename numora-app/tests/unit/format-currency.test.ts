/**
 * tests/unit/format-currency.test.ts
 * Etapa "5.10D — Billing Commercial Foundation" — `formatPrice`.
 */
import { describe, expect, it } from 'vitest'

import { formatPrice } from '@/lib/format/currency'

describe('formatPrice', () => {
  it('formata BRL com locale pt-BR', () => {
    expect(formatPrice(19.9, 'BRL')).toBe('R$ 19,90')
  })

  it('formata USD com locale en-US', () => {
    expect(formatPrice(5.99, 'USD')).toBe('$5.99')
  })

  it('formata valores inteiros anuais sem perder o símbolo de moeda', () => {
    expect(formatPrice(199, 'BRL')).toBe('R$ 199,00')
    expect(formatPrice(59, 'USD')).toBe('$59.00')
  })

  it('nunca arredonda de forma enganosa (2 casas decimais sempre)', () => {
    expect(formatPrice(34.9, 'BRL')).toBe('R$ 34,90')
  })
})
