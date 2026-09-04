/**
 * tests/unit/feedback-validation.test.ts
 * Etapa "F3 — Numora Feedback" — testa só a função pura
 * `validateFeedbackInput`/`isValidFeedbackType` (features/feedback/validation.ts),
 * sem nenhum acesso a rede/Supabase. Espelha os mesmos CHECK do banco
 * (`type in (...)`, `title`/`message` não vazios após trim, limites de
 * tamanho) — mesmo espírito de tests/unit/password-policy.test.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  isValidFeedbackType,
  validateFeedbackInput,
} from '@/features/feedback/validation'

describe('isValidFeedbackType', () => {
  it('aceita os 3 tipos válidos', () => {
    expect(isValidFeedbackType('praise')).toBe(true)
    expect(isValidFeedbackType('suggestion')).toBe(true)
    expect(isValidFeedbackType('problem')).toBe(true)
  })

  it('rejeita um tipo inválido', () => {
    expect(isValidFeedbackType('bug')).toBe(false)
    expect(isValidFeedbackType('')).toBe(false)
    expect(isValidFeedbackType('PRAISE')).toBe(false)
  })
})

describe('validateFeedbackInput', () => {
  const valid = { type: 'suggestion', title: 'Título válido', message: 'Mensagem válida' }

  it('aceita um input válido', () => {
    expect(validateFeedbackInput(valid)).toBeNull()
  })

  it('rejeita um tipo inválido', () => {
    expect(validateFeedbackInput({ ...valid, type: 'bug' })).not.toBeNull()
  })

  it('rejeita título vazio', () => {
    expect(validateFeedbackInput({ ...valid, title: '' })).not.toBeNull()
  })

  it('rejeita título só com espaços', () => {
    expect(validateFeedbackInput({ ...valid, title: '   ' })).not.toBeNull()
  })

  it(`rejeita título com mais de ${MAX_TITLE_LENGTH} caracteres`, () => {
    expect(validateFeedbackInput({ ...valid, title: 'a'.repeat(MAX_TITLE_LENGTH + 1) })).not.toBeNull()
  })

  it(`aceita título com exatamente ${MAX_TITLE_LENGTH} caracteres`, () => {
    expect(validateFeedbackInput({ ...valid, title: 'a'.repeat(MAX_TITLE_LENGTH) })).toBeNull()
  })

  it('rejeita mensagem vazia', () => {
    expect(validateFeedbackInput({ ...valid, message: '' })).not.toBeNull()
  })

  it('rejeita mensagem só com espaços', () => {
    expect(validateFeedbackInput({ ...valid, message: '   ' })).not.toBeNull()
  })

  it(`rejeita mensagem com mais de ${MAX_MESSAGE_LENGTH} caracteres`, () => {
    expect(validateFeedbackInput({ ...valid, message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) })).not.toBeNull()
  })

  it(`aceita mensagem com exatamente ${MAX_MESSAGE_LENGTH} caracteres`, () => {
    expect(validateFeedbackInput({ ...valid, message: 'a'.repeat(MAX_MESSAGE_LENGTH) })).toBeNull()
  })
})
