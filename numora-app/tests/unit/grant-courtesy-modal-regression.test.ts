/**
 * tests/unit/grant-courtesy-modal-regression.test.ts
 * Etapa "5.10U.2 — UX de Concessão de Cortesia".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de outras suítes desta base de código —
 * ver tests/unit/account-delete-billing-guard-regression.test.ts,
 * tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts): este
 * repositório não tem infraestrutura para renderizar
 * `GrantCourtesyModal.tsx` (`environment: 'node'`, sem jsdom/testing-
 * library) — não é possível "clicar" no botão e observar o DOM aqui. A
 * lógica pura já está coberta isoladamente em
 * tests/unit/grant-courtesy-validation.test.ts — o que falta cobrir é
 * exclusivamente a ORQUESTRAÇÃO: que o botão está de fato ligado ao
 * resultado da validação, que o campo mostra o erro pelo mecanismo
 * correto, e que o catch nunca mais expõe a mensagem técnica crua.
 *
 * Por isso este arquivo usa a mesma técnica de teste de caracterização já
 * estabelecida no projeto: inspeciona o CÓDIGO-FONTE como texto.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MODAL_FILE_PATH = path.resolve(__dirname, '../../app/admin/members/GrantCourtesyModal.tsx')

function readModalSource(): string {
  return readFileSync(MODAL_FILE_PATH, 'utf8')
}

describe('GrantCourtesyModal — validação de "Expira em" (5.10U.2)', () => {
  it('o arquivo do modal existe e é legível (pré-condição do teste)', () => {
    expect(() => readModalSource()).not.toThrow()
  })

  it('o input de data tem min nativo (primeira barreira) e o prop error ligado a dateError', () => {
    const source = readModalSource()
    const inputBlockStart = source.indexOf('label="Expira em (opcional)"')
    const inputBlockEnd = source.indexOf('/>', inputBlockStart)
    const inputBlock = source.slice(inputBlockStart, inputBlockEnd)

    expect(inputBlock).toMatch(/min=\{todayDateOnly\(\)\}/)
    expect(inputBlock).toMatch(/error=\{dateError \?\? undefined\}/)
  })

  it('o botão "Conceder cortesia" fica desabilitado quando dateError existir', () => {
    const source = readModalSource()
    expect(source).toMatch(/disabled=\{dateError !== null\}/)
  })

  it('handleSubmit tem uma guarda de dateError ANTES de setIsSubmitting(true) — defesa além do botão desabilitado', () => {
    const source = readModalSource()
    const handlerStart = source.indexOf('async function handleSubmit')
    const handlerEnd = source.indexOf('return (', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    const guardIndex = handlerBody.indexOf('if (dateError) return')
    const submittingIndex = handlerBody.indexOf('setIsSubmitting(true)')

    expect(guardIndex).toBeGreaterThan(-1)
    expect(submittingIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(submittingIndex)
  })

  it('o catch NUNCA usa (err as Error).message diretamente — sempre passa por isExpiresAtConstraintViolation/getUserFriendlyErrorMessage', () => {
    const source = readModalSource()
    const handlerStart = source.indexOf('async function handleSubmit')
    const handlerEnd = source.indexOf('return (', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    expect(handlerBody).not.toMatch(/setError\(\(err as Error\)\.message\)/)
    expect(handlerBody).toMatch(/isExpiresAtConstraintViolation\(err\)\s*\?\s*EXPIRES_AT_INVALID_MESSAGE\s*:\s*getUserFriendlyErrorMessage\(err\)/)
  })

  it('erro conhecido (constraint) e erro desconhecido (getUserFriendlyErrorMessage) são tratados na mesma expressão — nenhum dos dois pode "escapar" para o texto técnico cru', () => {
    const source = readModalSource()
    // getUserFriendlyErrorMessage é IMPORTADO (garantia estática de que a
    // função realmente existe e é usada — nunca só mencionada em comentário).
    expect(source).toMatch(/import \{ getUserFriendlyErrorMessage \} from '@\/lib\/errors\/get-user-friendly-error-message'/)
  })

  it('NUNCA referencia Stripe/Checkout neste arquivo (formulário de cortesia é inteiramente independente de billing)', () => {
    const source = readModalSource()
    expect(source).not.toMatch(/[Ss]tripe/)
    expect(source).not.toMatch(/\/api\/billing/)
  })

  it('NUNCA chama Supabase diretamente (nem antes nem depois desta etapa) — toda escrita passa pelo onSubmit injetado pelo caller (page.tsx -> AdminRepository)', () => {
    const source = readModalSource()
    expect(source).not.toMatch(/supabase/i)
    expect(source).not.toMatch(/\.rpc\(/)
    expect(source).not.toMatch(/\.insert\(/)
  })

  it('a constraint em si nunca é mencionada como algo a ser alterado/removido — só reconhecida por nome para tradução de mensagem', () => {
    const source = readModalSource()
    expect(source).toMatch(/chk_benefit_grants_expires_after_starts/)
    expect(source).not.toMatch(/drop constraint|alter constraint|disable trigger/i)
  })

  it('campo vazio continua semanticamente "sem prazo" — endOfDayLocalISOString só é chamado quando expiresAt é truthy', () => {
    const source = readModalSource()
    expect(source).toMatch(/expiresAt \? endOfDayLocalISOString\(expiresAt\) : null/)
  })
})
