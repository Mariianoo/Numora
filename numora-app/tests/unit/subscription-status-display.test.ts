import { describe, expect, it } from 'vitest'

import { subscriptionStatusLabel, subscriptionStatusBadgeTone, subscriptionIntervalLabel } from '@/lib/stripe/subscription-status-display'

describe('subscriptionStatusLabel', () => {
  it('traduz todos os 8 status reais do CHECK constraint de subscriptions.status', () => {
    expect(subscriptionStatusLabel('trialing')).toBe('Em trial')
    expect(subscriptionStatusLabel('active')).toBe('Ativa')
    expect(subscriptionStatusLabel('past_due')).toBe('Pagamento atrasado')
    expect(subscriptionStatusLabel('canceled')).toBe('Cancelada')
    expect(subscriptionStatusLabel('incomplete')).toBe('Incompleta')
    expect(subscriptionStatusLabel('incomplete_expired')).toBe('Incompleta (expirada)')
    expect(subscriptionStatusLabel('unpaid')).toBe('Não paga')
    expect(subscriptionStatusLabel('paused')).toBe('Pausada')
  })

  it('status desconhecido devolve o próprio valor (nunca inventa um rótulo)', () => {
    expect(subscriptionStatusLabel('algo_novo')).toBe('algo_novo')
  })
})

describe('subscriptionStatusBadgeTone', () => {
  it('active é success, past_due/incomplete/unpaid são danger, canceled/paused/incomplete_expired são neutral, trialing é accent', () => {
    expect(subscriptionStatusBadgeTone('active')).toBe('success')
    expect(subscriptionStatusBadgeTone('past_due')).toBe('danger')
    expect(subscriptionStatusBadgeTone('incomplete')).toBe('danger')
    expect(subscriptionStatusBadgeTone('unpaid')).toBe('danger')
    expect(subscriptionStatusBadgeTone('canceled')).toBe('neutral')
    expect(subscriptionStatusBadgeTone('paused')).toBe('neutral')
    expect(subscriptionStatusBadgeTone('incomplete_expired')).toBe('neutral')
    expect(subscriptionStatusBadgeTone('trialing')).toBe('accent')
  })

  it('status desconhecido devolve neutral', () => {
    expect(subscriptionStatusBadgeTone('algo_novo')).toBe('neutral')
  })
})

describe('subscriptionIntervalLabel', () => {
  it('month vira Mensal, year vira Anual', () => {
    expect(subscriptionIntervalLabel('month')).toBe('Mensal')
    expect(subscriptionIntervalLabel('year')).toBe('Anual')
  })

  it('null vira "—" (nunca lança erro)', () => {
    expect(subscriptionIntervalLabel(null)).toBe('—')
  })
})
