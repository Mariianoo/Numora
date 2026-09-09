/**
 * tests/unit/format-date.test.ts
 * `endOfDayLocalISOString` — correção do bug real "cortesia expira hoje
 * viola chk_benefit_grants_expires_after_starts" (ver
 * app/admin/members/GrantCourtesyModal.tsx). A causa era `new
 * Date("YYYY-MM-DD").toISOString()`, que a spec ECMA-262 interpreta como
 * meia-noite UTC (não local) — estes testes travam o comportamento correto
 * (fim do dia, no fuso LOCAL do runtime) para não regredir.
 */
import { describe, expect, it } from 'vitest'

import { endOfDayLocalISOString } from '@/lib/format/date'

function assertEndOfDayLocal(result: string, year: number, month: number, day: number) {
  const parsed = new Date(result)
  expect(parsed.getFullYear()).toBe(year)
  expect(parsed.getMonth()).toBe(month - 1)
  expect(parsed.getDate()).toBe(day)
  expect(parsed.getHours()).toBe(23)
  expect(parsed.getMinutes()).toBe(59)
  expect(parsed.getSeconds()).toBe(59)
  expect(parsed.getMilliseconds()).toBe(999)
}

describe('endOfDayLocalISOString', () => {
  it('2026-09-09 → fim do dia local (23:59:59.999), não meia-noite', () => {
    assertEndOfDayLocal(endOfDayLocalISOString('2026-09-09'), 2026, 9, 9)
  })

  it('2026-09-10 → fim do dia local (23:59:59.999), não meia-noite', () => {
    assertEndOfDayLocal(endOfDayLocalISOString('2026-09-10'), 2026, 9, 10)
  })

  it('NUNCA produz T00:00:00.000Z só por o input ser date-only (bug original)', () => {
    const result = endOfDayLocalISOString('2026-09-09')
    expect(result.endsWith('T00:00:00.000Z')).toBe(false)
  })

  it('difere do comportamento incorreto original (new Date(dateOnly).toISOString())', () => {
    const buggy = new Date('2026-09-09').toISOString()
    const fixed = endOfDayLocalISOString('2026-09-09')
    expect(fixed).not.toBe(buggy)
  })

  it('é sempre um instante estritamente posterior a "agora" quando a data é hoje ou futura', () => {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    const result = endOfDayLocalISOString(`${y}-${m}-${d}`)
    expect(new Date(result).getTime()).toBeGreaterThan(Date.now())
  })

  it('para uma data no passado, o instante gerado continua no passado (constraint deve rejeitar)', () => {
    const result = endOfDayLocalISOString('2020-01-01')
    expect(new Date(result).getTime()).toBeLessThan(Date.now())
  })

  it('respeita virada de mês/ano (2026-12-31 → 23:59:59.999 local do próprio dia, não rola para o ano seguinte)', () => {
    assertEndOfDayLocal(endOfDayLocalISOString('2026-12-31'), 2026, 12, 31)
  })
})
