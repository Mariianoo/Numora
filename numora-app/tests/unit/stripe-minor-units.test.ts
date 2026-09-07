/**
 * tests/unit/stripe-minor-units.test.ts
 * Etapa "Stripe 4.1A" — `toStripeMinorUnits` (lib/stripe/minor-units.ts).
 * Cobre exatamente os 8 valores comerciais reais + casos de representação
 * decimal problemática + rejeição de entradas inválidas.
 */
import { describe, expect, it } from 'vitest'

import { toStripeMinorUnits } from '@/lib/stripe/minor-units'

describe('toStripeMinorUnits', () => {
  it.each([
    [19.9, 1990],
    [199, 19900],
    [5.99, 599],
    [59, 5900],
    [34.9, 3490],
    [349, 34900],
    [9.99, 999],
    [99, 9900],
  ])('converte %s para %i minor units (os 8 preços comerciais reais)', (amount, expected) => {
    expect(toStripeMinorUnits(amount)).toBe(expected)
  })

  it('lida corretamente com representação de ponto flutuante problemática (0.1 + 0.2 style)', () => {
    // 19.9 * 100 em JS puro não é exatamente 1990 (erro de ponto flutuante) —
    // Math.round precisa corrigir isso, não propagar o erro.
    expect(19.9 * 100).not.toBe(1990)
    expect(toStripeMinorUnits(19.9)).toBe(1990)
    expect(toStripeMinorUnits(0.1 + 0.2)).toBe(30) // 0.30000000000000004 → 30
  })

  it('rejeita zero', () => {
    expect(() => toStripeMinorUnits(0)).toThrow(/positivo/)
  })

  it('rejeita valor negativo', () => {
    expect(() => toStripeMinorUnits(-19.9)).toThrow(/positivo/)
  })

  it('rejeita NaN', () => {
    expect(() => toStripeMinorUnits(NaN)).toThrow(/inválido/)
  })

  it('rejeita Infinity', () => {
    expect(() => toStripeMinorUnits(Infinity)).toThrow(/inválido/)
  })

  it('rejeita valor com mais de 2 casas decimais (não é um valor monetário válido)', () => {
    expect(() => toStripeMinorUnits(19.999)).toThrow(/precisão inválida/)
  })
})
