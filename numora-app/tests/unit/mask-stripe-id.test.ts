import { describe, expect, it } from 'vitest'

import { maskStripeId } from '@/lib/format/mask-stripe-id'

describe('maskStripeId', () => {
  it('mascara um customer id real, preservando o prefixo e os 4 últimos caracteres', () => {
    expect(maskStripeId('cus_1234567890abcdef')).toBe('cus_********cdef')
  })

  it('mascara um subscription id real, preservando o prefixo e os 4 últimos caracteres', () => {
    expect(maskStripeId('sub_1234567890abcdef')).toBe('sub_********cdef')
  })

  it('nunca altera/expõe o valor real — o retorno nunca contém a parte mascarada do ID original', () => {
    const id = 'cus_1234567890abcdef'
    const masked = maskStripeId(id)
    expect(masked).not.toBe(id)
    expect(masked).not.toContain('123456')
  })

  it('null vira "—"', () => {
    expect(maskStripeId(null)).toBe('—')
  })

  it('undefined vira "—"', () => {
    expect(maskStripeId(undefined)).toBe('—')
  })

  it('string vazia vira "—"', () => {
    expect(maskStripeId('')).toBe('—')
  })

  it('string curta demais para revelar um sufixo de 4 é mascarada por completo, sem lançar erro', () => {
    expect(() => maskStripeId('cus_ab')).not.toThrow()
    expect(maskStripeId('cus_ab')).toBe('cus_**')
    expect(maskStripeId('cus_')).toBe('cus_*')
  })

  it('string sem "_" (sem prefixo reconhecível) mascara tudo exceto os últimos 4 caracteres', () => {
    expect(maskStripeId('1234567890abcdef')).toBe('********cdef')
  })

  it('string de exatamente 4 caracteres após o prefixo é mascarada por completo (nunca revela tudo)', () => {
    expect(maskStripeId('cus_abcd')).toBe('cus_****')
  })
})
