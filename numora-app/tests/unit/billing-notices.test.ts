/**
 * tests/unit/billing-notices.test.ts
 * Etapa "B1 — Official Launch, código de cobrança" — textos e regras puras
 * dos avisos de cobrança do Dashboard (`lib/billing/billing-notices.ts`) e a
 * política de `past_due` (mantém acesso — inalterada por este bloco).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PAYMENT_PENDING_NOTICE, getCheckoutReturnNotice, isPaymentPendingStatus } from '@/lib/billing/billing-notices'

const ROOT = path.resolve(__dirname, '../..')

describe('getCheckoutReturnNotice — copy por resultado', () => {
  it('cancel: neutro, sem afirmar nada além de "nenhuma cobrança foi concluída"', () => {
    const notice = getCheckoutReturnNotice('cancel')
    expect(notice.title).toBe('Você cancelou a contratação')
    expect(notice.description).toBe('Nenhuma cobrança foi concluída.')
    expect(notice.tone).toBe('info')
  })

  it('pending: "Estamos confirmando seu pagamento" e pede para atualizar — não afirma que o plano mudou', () => {
    const notice = getCheckoutReturnNotice('pending')
    expect(notice.title).toBe('Estamos confirmando seu pagamento')
    expect(notice.description).toMatch(/Atualize a página/)
    expect(`${notice.title} ${notice.description}`).not.toMatch(/ativo|atualizado|confirmado/i)
  })

  it('confirmed: só existe quando o servidor sincronizou uma subscription realmente ativa', () => {
    const notice = getCheckoutReturnNotice('confirmed')
    expect(notice.tone).toBe('success')
    expect(notice.title).toBe('Pagamento confirmado')
  })

  it('invalid: mesma mensagem neutra para qualquer motivo (não revela se a Session existe ou é de outro usuário)', () => {
    const notice = getCheckoutReturnNotice('invalid')
    expect(notice.title).toBe('Não foi possível verificar esta contratação')
    expect(`${notice.title} ${notice.description}`).not.toMatch(/outro usuário|não existe|expirad|stripe|sess[aã]o/i)
  })

  it('unavailable: não afirma sucesso nem falha do pagamento', () => {
    const notice = getCheckoutReturnNotice('unavailable')
    expect(notice.description).toMatch(/Se você concluiu a contratação/)
  })

  it('nenhuma copy cita Stripe, IDs, valores ou dados da Session', () => {
    for (const input of ['confirmed', 'pending', 'cancel', 'invalid', 'unavailable'] as const) {
      const notice = getCheckoutReturnNotice(input)
      expect(`${notice.title} ${notice.description}`).not.toMatch(/stripe|cs_|sub_|cus_|R\$|price/i)
    }
  })
})

describe('past_due — pagamento pendente (a política de acesso NÃO muda)', () => {
  it('isPaymentPendingStatus só é verdadeiro para past_due', () => {
    expect(isPaymentPendingStatus('past_due')).toBe(true)
    for (const status of ['active', 'trialing', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', '', null, undefined]) {
      expect(isPaymentPendingStatus(status)).toBe(false)
    }
  })

  it('o aviso diz "Pagamento pendente" e que o acesso continua ativo — sem prometer prazo próprio (nenhum grace period criado)', () => {
    expect(PAYMENT_PENDING_NOTICE.title).toBe('Pagamento pendente')
    expect(PAYMENT_PENDING_NOTICE.description).toMatch(/acesso continua ativo/)
    expect(PAYMENT_PENDING_NOTICE.description).not.toMatch(/\d+ dias?|prazo|até o dia/i)
    expect(PAYMENT_PENDING_NOTICE.tone).toBe('warning')
  })

  it('effective_plans() continua concedendo acesso em past_due — as migrations que definem a regra estão inalteradas (nenhuma migration nova neste bloco)', () => {
    const latest = readFileSync(path.join(ROOT, 'supabase/migrations/20260818131512_create_effective_plans_source.sql'), 'utf8')
    expect(latest).toMatch(/where s\.status in \('trialing', 'active', 'past_due'\)/)

    const subscriptionManagement = readFileSync(path.join(ROOT, 'lib/stripe/subscription-management.ts'), 'utf8')
    expect(subscriptionManagement).toMatch(/ELIGIBLE_STATUSES = \['trialing', 'active', 'past_due'\]/)
  })
})
