/**
 * tests/unit/stripe-catalog-validation.test.ts
 * Etapa "Stripe 4.1A" — `parseCommercialPlanPriceRow`/
 * `assertNoDuplicateCombinations` (lib/stripe/catalog.ts). Puras — linhas
 * fabricadas, nenhum acesso ao banco (a leitura real contra DEV está em
 * tests/integration/stripe-catalog.test.ts).
 */
import { describe, expect, it } from 'vitest'

import { assertNoDuplicateCombinations, parseCommercialPlanPriceRow, type RawCommercialPlanPriceRow } from '@/lib/stripe/catalog'

function makeRow(overrides: Partial<RawCommercialPlanPriceRow> = {}): RawCommercialPlanPriceRow {
  return {
    id: 'row-1',
    planId: 'plan-1',
    planSlug: 'pro',
    interval: 'month',
    currency: 'BRL',
    amount: 19.9,
    stripePriceId: null,
    active: false,
    ...overrides,
  }
}

describe('parseCommercialPlanPriceRow', () => {
  it('aceita uma linha válida (rascunho, sem stripe_price_id)', () => {
    const result = parseCommercialPlanPriceRow(makeRow())
    expect(result).toEqual({
      planPriceId: 'row-1',
      planId: 'plan-1',
      planSlug: 'pro',
      interval: 'month',
      currency: 'BRL',
      amount: 19.9,
      stripePriceId: null,
      active: false,
    })
  })

  it('aceita amount vindo como string (numeric do Postgres via PostgREST)', () => {
    const result = parseCommercialPlanPriceRow(makeRow({ amount: '19.90' }))
    expect(result.amount).toBe(19.9)
  })

  it('rejeita slug inválido', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ planSlug: 'free' }))).toThrow(/plano pago conhecido/)
  })

  it('rejeita slug ausente (null)', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ planSlug: null }))).toThrow(/plano pago conhecido/)
  })

  it('rejeita currency inválida', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ currency: 'EUR' }))).toThrow(/currency inválida/)
  })

  it('rejeita interval inválido', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ interval: 'week' }))).toThrow(/interval inválido/)
  })

  it('rejeita amount inválido (zero)', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ amount: 0 }))).toThrow(/amount inválido/)
  })

  it('rejeita amount inválido (negativo)', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ amount: -5 }))).toThrow(/amount inválido/)
  })

  it('rejeita amount inválido (não numérico)', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ amount: 'abacate' }))).toThrow(/amount inválido/)
  })

  it('rejeita active=true sem stripePriceId (estado impossível, defesa em profundidade)', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ active: true, stripePriceId: null }))).toThrow(/estado impossível/)
  })

  it('aceita active=true com stripePriceId preenchido', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ active: true, stripePriceId: 'price_123' }))).not.toThrow()
  })

  it('rejeita stripePriceId vazio (nem null nem um ID real)', () => {
    expect(() => parseCommercialPlanPriceRow(makeRow({ stripePriceId: '   ' }))).toThrow(/vazio/)
  })
})

describe('assertNoDuplicateCombinations', () => {
  it('não lança quando todas as combinações são únicas', () => {
    const rows = [
      parseCommercialPlanPriceRow(makeRow({ id: 'a', interval: 'month', currency: 'BRL' })),
      parseCommercialPlanPriceRow(makeRow({ id: 'b', interval: 'year', currency: 'BRL' })),
      parseCommercialPlanPriceRow(makeRow({ id: 'c', interval: 'month', currency: 'USD' })),
    ]
    expect(() => assertNoDuplicateCombinations(rows)).not.toThrow()
  })

  it('lança quando a mesma combinação plano+intervalo+moeda aparece duas vezes', () => {
    const rows = [
      parseCommercialPlanPriceRow(makeRow({ id: 'a', interval: 'month', currency: 'BRL' })),
      parseCommercialPlanPriceRow(makeRow({ id: 'b', interval: 'month', currency: 'BRL' })),
    ]
    expect(() => assertNoDuplicateCombinations(rows)).toThrow(/combinação duplicada/)
  })
})
