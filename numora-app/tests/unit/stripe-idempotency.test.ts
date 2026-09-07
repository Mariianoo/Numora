/**
 * tests/unit/stripe-idempotency.test.ts
 * Etapa "Stripe 4.1A" — `resolveExistingProduct`/`resolveExistingPrice`
 * (lib/stripe/idempotency.ts). Puras — candidatos fabricados, nenhuma
 * chamada ao Stripe. Confirma a regra absoluta: nunca escolher
 * arbitrariamente entre múltiplos candidatos.
 */
import { describe, expect, it } from 'vitest'

import { buildCreationIdempotencyKey, resolveExistingPrice, resolveExistingProduct } from '@/lib/stripe/idempotency'

describe('resolveExistingProduct', () => {
  it('not_found quando nenhum candidato tem o metadata correspondente', () => {
    const result = resolveExistingProduct([{ id: 'prod_a', metadata: { numora_plan_slug: 'premium' } }], 'pro')
    expect(result).toEqual({ status: 'not_found' })
  })

  it('found quando exatamente um candidato corresponde', () => {
    const result = resolveExistingProduct(
      [
        { id: 'prod_a', metadata: { numora_plan_slug: 'pro' } },
        { id: 'prod_b', metadata: { numora_plan_slug: 'premium' } },
      ],
      'pro',
    )
    expect(result).toEqual({ status: 'found', id: 'prod_a' })
  })

  it('conflict quando mais de um candidato corresponde — nunca escolhe o primeiro arbitrariamente', () => {
    const result = resolveExistingProduct(
      [
        { id: 'prod_a', metadata: { numora_plan_slug: 'pro' } },
        { id: 'prod_b', metadata: { numora_plan_slug: 'pro' } },
      ],
      'pro',
    )
    expect(result).toEqual({ status: 'conflict', matchingIds: ['prod_a', 'prod_b'] })
  })
})

describe('resolveExistingPrice', () => {
  it('not_found quando nenhum candidato tem o lookup_key correspondente', () => {
    const result = resolveExistingPrice([{ id: 'price_a', lookupKey: 'numora_premium_brl_month' }], 'numora_pro_brl_month')
    expect(result).toEqual({ status: 'not_found' })
  })

  it('found quando exatamente um candidato corresponde', () => {
    const result = resolveExistingPrice(
      [
        { id: 'price_a', lookupKey: 'numora_pro_brl_month' },
        { id: 'price_b', lookupKey: 'numora_pro_brl_year' },
      ],
      'numora_pro_brl_month',
    )
    expect(result).toEqual({ status: 'found', id: 'price_a' })
  })

  it('conflict quando mais de um candidato corresponde — nunca escolhe o primeiro arbitrariamente', () => {
    const result = resolveExistingPrice(
      [
        { id: 'price_a', lookupKey: 'numora_pro_brl_month' },
        { id: 'price_b', lookupKey: 'numora_pro_brl_month' },
      ],
      'numora_pro_brl_month',
    )
    expect(result).toEqual({ status: 'conflict', matchingIds: ['price_a', 'price_b'] })
  })

  it('trata lookupKey null como não correspondente', () => {
    const result = resolveExistingPrice([{ id: 'price_a', lookupKey: null }], 'numora_pro_brl_month')
    expect(result).toEqual({ status: 'not_found' })
  })
})

describe('buildCreationIdempotencyKey', () => {
  it('é determinística para o mesmo recurso/identificador', () => {
    expect(buildCreationIdempotencyKey('price', 'numora_pro_brl_month')).toBe(buildCreationIdempotencyKey('price', 'numora_pro_brl_month'))
  })

  it('difere por tipo de recurso e por identificador', () => {
    const a = buildCreationIdempotencyKey('product', 'numora_pro')
    const b = buildCreationIdempotencyKey('price', 'numora_pro')
    const c = buildCreationIdempotencyKey('product', 'numora_premium')
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})
