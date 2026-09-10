/**
 * tests/unit/pricing-display.test.ts
 * Etapa "5.10D — Billing Commercial Foundation" — `computeYearlySavingsPercent`.
 */
import { describe, expect, it } from 'vitest'

import { computeYearlySavingsPercent } from '@/lib/stripe/pricing-display'

describe('computeYearlySavingsPercent', () => {
  it('Pro BRL (19.90/mês, 199/ano) → 16% (nunca arredonda para cima)', () => {
    // 19.90 * 12 = 238.80; 1 - 199/238.80 = 0.1667... → 16 (piso, nunca 17)
    expect(computeYearlySavingsPercent(19.9, 199)).toBe(16)
  })

  it('Premium BRL (34.90/mês, 349/ano)', () => {
    expect(computeYearlySavingsPercent(34.9, 349)).toBe(Math.floor((1 - 349 / (34.9 * 12)) * 100))
  })

  it('sem economia real (anual = 12x mensal) → 0%', () => {
    expect(computeYearlySavingsPercent(10, 120)).toBe(0)
  })

  it('anual mais caro que 12x mensal → nunca economia negativa, sempre 0', () => {
    expect(computeYearlySavingsPercent(10, 200)).toBe(0)
  })

  it('monthlyAmount = 0 → 0, nunca divisão por zero/NaN', () => {
    expect(computeYearlySavingsPercent(0, 100)).toBe(0)
  })
})
