/**
 * features/feedback/validation.ts
 * Validação de feedback — fonte única de verdade no client, espelhando
 * (sem substituir) os CHECK constraints reais de `feedbacks`
 * (`create_feedbacks.sql`). O banco continua sendo a autoridade final:
 * isto é só feedback antecipado de UX, mesmo espírito de
 * `evaluateSingleComponentPercentage` (features/coin-composition).
 * `trim()` aqui espelha exatamente `char_length(trim(title))` no SQL —
 * um título só com espaços é tratado como vazio dos dois lados.
 */
import type { FeedbackType } from './types'

export const FEEDBACK_TYPES: readonly FeedbackType[] = ['praise', 'suggestion', 'problem']

export const MAX_TITLE_LENGTH = 120
export const MAX_MESSAGE_LENGTH = 4000

export function isValidFeedbackType(value: string): value is FeedbackType {
  return (FEEDBACK_TYPES as readonly string[]).includes(value)
}

/** `null` = válido. Nunca confiar só nisto — o INSERT real ainda passa pelo CHECK do banco. */
export function validateFeedbackInput(input: { type: string; title: string; message: string }): string | null {
  if (!isValidFeedbackType(input.type)) {
    return 'Selecione um tipo de feedback válido.'
  }

  const title = input.title.trim()
  if (title.length === 0) {
    return 'Informe um título para o seu feedback.'
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `O título pode ter no máximo ${MAX_TITLE_LENGTH} caracteres.`
  }

  const message = input.message.trim()
  if (message.length === 0) {
    return 'Escreva sua mensagem antes de enviar.'
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return `A mensagem pode ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`
  }

  return null
}
