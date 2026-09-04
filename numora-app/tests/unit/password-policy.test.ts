import { describe, expect, it } from 'vitest'

import { isPasswordStrong, MIN_PASSWORD_LENGTH, PASSWORD_REQUIREMENTS } from '@/lib/validation/password-policy'

describe('isPasswordStrong', () => {
  it('aceita uma senha que cumpre todos os requisitos', () => {
    expect(isPasswordStrong('Numora@2026')).toBe(true)
  })

  it('rejeita uma senha vazia', () => {
    expect(isPasswordStrong('')).toBe(false)
  })

  it(`rejeita uma senha com menos de ${MIN_PASSWORD_LENGTH} caracteres`, () => {
    expect(isPasswordStrong('Aa1!')).toBe(false)
  })

  it('rejeita senha sem letra maiúscula', () => {
    expect(isPasswordStrong('numora@2026')).toBe(false)
  })

  it('rejeita senha sem letra minúscula', () => {
    expect(isPasswordStrong('NUMORA@2026')).toBe(false)
  })

  it('rejeita senha sem número', () => {
    expect(isPasswordStrong('Numora@Beta')).toBe(false)
  })

  it('rejeita senha sem símbolo', () => {
    expect(isPasswordStrong('Numora2026')).toBe(false)
  })
})

describe('PASSWORD_REQUIREMENTS', () => {
  it('cada requisito individual reconhece corretamente sua própria condição', () => {
    const byId = Object.fromEntries(PASSWORD_REQUIREMENTS.map((requirement) => [requirement.id, requirement]))

    expect(byId.length.test('1234567')).toBe(false)
    expect(byId.length.test('12345678')).toBe(true)

    expect(byId.uppercase.test('abc')).toBe(false)
    expect(byId.uppercase.test('Abc')).toBe(true)

    expect(byId.lowercase.test('ABC')).toBe(false)
    expect(byId.lowercase.test('ABc')).toBe(true)

    expect(byId.number.test('abc')).toBe(false)
    expect(byId.number.test('abc1')).toBe(true)

    expect(byId.symbol.test('abc1')).toBe(false)
    expect(byId.symbol.test('abc1!')).toBe(true)
  })

  it('nenhum requisito é satisfeito por uma senha vazia', () => {
    for (const requirement of PASSWORD_REQUIREMENTS) {
      expect(requirement.test('')).toBe(false)
    }
  })
})
