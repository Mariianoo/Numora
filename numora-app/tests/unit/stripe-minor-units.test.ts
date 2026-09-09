/**
 * tests/unit/stripe-minor-units.test.ts
 * Etapa "Stripe 4.1A" — `toStripeMinorUnits` (lib/stripe/minor-units.ts).
 * Cobre exatamente os 8 valores comerciais reais + casos de representação
 * decimal problemática + rejeição de entradas inválidas.
 *
 * Etapa "Stripe 5.5 — Invoice & Payment Sync" — `fromStripeMinorUnits`, a
 * conversão inversa (usada para `invoice.amount_paid`/`amount_due`).
 */
import { describe, expect, it } from 'vitest'

import { fromStripeMinorUnits, toStripeMinorUnits } from '@/lib/stripe/minor-units'

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

describe('fromStripeMinorUnits', () => {
  it.each([
    [1990, 19.9],
    [19900, 199],
    [599, 5.99],
    [5900, 59],
    [3490, 34.9],
    [34900, 349],
    [999, 9.99],
    [9900, 99],
  ])('converte %i minor units para %s (os 8 preços comerciais reais, na direção inversa)', (minorUnits, expected) => {
    expect(fromStripeMinorUnits(minorUnits)).toBe(expected)
  })

  it('é exatamente a inversa de toStripeMinorUnits para todos os 8 valores comerciais', () => {
    for (const amount of [19.9, 199, 5.99, 59, 34.9, 349, 9.99, 99]) {
      expect(fromStripeMinorUnits(toStripeMinorUnits(amount))).toBe(amount)
    }
  })

  it('valores pequenos (< 100 minor units) são preenchidos com zero à esquerda corretamente (ex.: 5 → 0.05)', () => {
    expect(fromStripeMinorUnits(5)).toBe(0.05)
    expect(fromStripeMinorUnits(50)).toBe(0.5)
    expect(fromStripeMinorUnits(0)).toBe(0)
  })

  it('nunca usa divisão de ponto flutuante — resultado determinístico mesmo para valores que testam o limite de precisão', () => {
    expect(fromStripeMinorUnits(1990)).toBe(19.9) // não 19.900000000000002 nem 19.899999999999999
    expect(fromStripeMinorUnits(1)).toBe(0.01)
  })

  it('rejeita valor não-inteiro (minor units do Stripe são sempre inteiros)', () => {
    expect(() => fromStripeMinorUnits(19.9)).toThrow(/inteiro/)
  })

  it('rejeita valor negativo', () => {
    expect(() => fromStripeMinorUnits(-100)).toThrow(/não-negativo/)
  })

  it('rejeita NaN/Infinity', () => {
    expect(() => fromStripeMinorUnits(NaN)).toThrow(/inválido/)
    expect(() => fromStripeMinorUnits(Infinity)).toThrow(/inválido/)
  })
})
