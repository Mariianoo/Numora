import { describe, expect, it } from 'vitest'

import { normalizeUsername, validateUsernameFormat } from '@/features/profile/username'

describe('normalizeUsername', () => {
  it('remove espaços nas pontas', () => {
    expect(normalizeUsername('  joao  ')).toBe('joao')
  })

  it('força minúsculas', () => {
    expect(normalizeUsername('JoaoColecionador')).toBe('joaocolecionador')
  })

  it('nunca rejeita por causa de espaço/maiúscula — só normaliza', () => {
    expect(() => normalizeUsername('  Joao_123  ')).not.toThrow()
    expect(normalizeUsername('  Joao_123  ')).toBe('joao_123')
  })
})

describe('validateUsernameFormat', () => {
  it('aceita formatos válidos', () => {
    expect(validateUsernameFormat('joao')).toBeNull()
    expect(validateUsernameFormat('joao_colecionador')).toBeNull()
    expect(validateUsernameFormat('j_o1')).toBeNull()
    expect(validateUsernameFormat('a'.repeat(20))).toBeNull()
  })

  it('rejeita menos de 3 caracteres', () => {
    expect(validateUsernameFormat('ab')).not.toBeNull()
  })

  it('rejeita mais de 20 caracteres', () => {
    expect(validateUsernameFormat('a'.repeat(21))).not.toBeNull()
  })

  it('rejeita início por número', () => {
    expect(validateUsernameFormat('1joao')).not.toBeNull()
  })

  it('rejeita maiúsculas (formato esperado já normalizado)', () => {
    expect(validateUsernameFormat('Joao')).not.toBeNull()
  })

  it('rejeita caracteres fora de [a-z0-9_]', () => {
    expect(validateUsernameFormat('joao.silva')).not.toBeNull()
    expect(validateUsernameFormat('joao-silva')).not.toBeNull()
    expect(validateUsernameFormat('joão')).not.toBeNull()
  })
})
