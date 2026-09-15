/**
 * tests/unit/grant-courtesy-validation.test.ts
 * Etapa "5.10U.2 — UX de Concessão de Cortesia" — testa as funções puras
 * exportadas por `app/admin/members/GrantCourtesyModal.tsx`
 * (`validateExpiresAt`/`isExpiresAtConstraintViolation`), sem nenhum
 * acesso a Supabase/React/DOM. Espelha exatamente a regra real de
 * `chk_benefit_grants_expires_after_starts`
 * (`expires_at is null or expires_at > starts_at`, `starts_at` = `now()`
 * no INSERT — migration `create_benefit_grants.sql`, nunca alterada nesta
 * etapa) — os testes de limite ("hoje") comprovam que a validação nunca
 * diverge dessa regra.
 */
import { describe, expect, it } from 'vitest'

import {
  EXPIRES_AT_INVALID_MESSAGE,
  isExpiresAtConstraintViolation,
  validateExpiresAt,
} from '@/app/admin/members/GrantCourtesyModal'

describe('validateExpiresAt — campo vazio (cortesia sem prazo)', () => {
  it('string vazia é sempre válida, independente de "now"', () => {
    expect(validateExpiresAt('')).toBeNull()
    expect(validateExpiresAt('', new Date(2020, 0, 1))).toBeNull()
  })
})

describe('validateExpiresAt — data futura', () => {
  it('data claramente futura é válida', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0)
    expect(validateExpiresAt('2026-03-06', now)).toBeNull()
    expect(validateExpiresAt('2026-12-31', now)).toBeNull()
  })
})

describe('validateExpiresAt — data passada', () => {
  it('data claramente passada (o cenário real relatado: meses atrás) é inválida', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0) // 15 de setembro de 2026
    expect(validateExpiresAt('2025-09-20', now)).toBe(EXPIRES_AT_INVALID_MESSAGE)
  })

  it('ontem é inválido', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0)
    expect(validateExpiresAt('2026-03-04', now)).toBe(EXPIRES_AT_INVALID_MESSAGE)
  })
})

describe('validateExpiresAt — limite "hoje" (mesma semântica de chk_benefit_grants_expires_after_starts)', () => {
  it('hoje, ainda durante o dia, é válido (fim do dia local > now — mesma regra que já permite "cortesia expirando hoje" no banco)', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0)
    expect(validateExpiresAt('2026-03-05', now)).toBeNull()
  })

  it('hoje, faltando 1ms para o fim do dia local, ainda é válido', () => {
    const now = new Date(2026, 2, 5, 23, 59, 59, 998)
    expect(validateExpiresAt('2026-03-05', now)).toBeNull()
  })

  it('hoje, exatamente no instante do fim do dia local, é inválido (constraint exige ">", nunca ">=")', () => {
    const now = new Date(2026, 2, 5, 23, 59, 59, 999)
    expect(validateExpiresAt('2026-03-05', now)).toBe(EXPIRES_AT_INVALID_MESSAGE)
  })

  it('hoje, 1ms depois do fim do dia local, é inválido', () => {
    const now = new Date(2026, 2, 6, 0, 0, 0, 0)
    expect(validateExpiresAt('2026-03-05', now)).toBe(EXPIRES_AT_INVALID_MESSAGE)
  })
})

describe('validateExpiresAt — comparação por instante absoluto (nunca string de data local)', () => {
  it('nunca compara strings de data diretamente — "2025-09-20" < "2026-09-15" lexicograficamente também seria inválido, mas o teste real é sobre INSTANTES, não sobre comparação textual', () => {
    // Este teste existe para documentar a garantia, não para pegar um bug
    // específico: se a implementação um dia trocasse para comparação de
    // string, datas como "2026-3-5" vs "2026-03-05" (sem zero à esquerda)
    // quebrariam silenciosamente — validateExpiresAt nunca faz isso, sempre
    // converte para um instante real via endOfDayLocalISOString.
    const now = new Date(2026, 2, 5, 0, 0, 0)
    expect(validateExpiresAt('2026-03-05', now)).toBeNull()
  })
})

describe('isExpiresAtConstraintViolation', () => {
  it('reconhece a mensagem real do Postgres, mesmo já embrulhada por AdminRepository', () => {
    const err = new Error(
      '[AdminRepository] Falha ao conceder cortesia: new row for relation "benefit_grants" violates check constraint "chk_benefit_grants_expires_after_starts"',
    )
    expect(isExpiresAtConstraintViolation(err)).toBe(true)
  })

  it('NUNCA reconhece um erro genérico/de rede como esta constraint específica', () => {
    expect(isExpiresAtConstraintViolation(new Error('Failed to fetch'))).toBe(false)
    expect(isExpiresAtConstraintViolation(new Error('[AdminRepository] Falha ao conceder cortesia: conexão perdida'))).toBe(false)
    expect(isExpiresAtConstraintViolation(null)).toBe(false)
    expect(isExpiresAtConstraintViolation(undefined)).toBe(false)
  })

  it('não confunde com outra constraint de benefit_grants (nome diferente)', () => {
    const err = new Error('violates check constraint "chk_benefit_grants_type"')
    expect(isExpiresAtConstraintViolation(err)).toBe(false)
  })
})
