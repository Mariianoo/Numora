/**
 * tests/unit/signup-validation.test.ts — Etapa "B2.4 — Signup server-controlled".
 * Validação servidor-side pura do cadastro (lib/auth/signup-validation.ts):
 * sem senha, somente Brasil, Termos/Privacidade/18+ obrigatórios, versões
 * vigentes, marketing opcional, nada jurídico na metadata.
 */
import { describe, expect, it } from 'vitest'

import { SIGNUP_ALLOWED_COUNTRY, SIGNUP_ERROR_MESSAGES, validateSignupPayload } from '@/lib/auth/signup-validation'
import { AGE_CONFIRMATION_VERSION, MARKETING_OPT_IN_VERSION, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria Silva',
    email: 'Maria@Example.com',
    countryCode: 'BR',
    termsAccepted: true,
    privacyAccepted: true,
    age18Confirmed: true,
    marketingOptIn: false,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
    ...overrides,
  }
}

describe('validateSignupPayload — caminho feliz', () => {
  it('payload completo com BR é válido; e-mail normalizado; consentimentos vêm das constantes do servidor', () => {
    const result = validateSignupPayload(validPayload())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.countryCode).toBe('BR')
    expect(result.data.email).toBe('maria@example.com')
    expect(result.data.consents).toEqual([
      { documentType: 'terms', documentVersion: TERMS_VERSION },
      { documentType: 'privacy', documentVersion: PRIVACY_VERSION },
      { documentType: 'age_18', documentVersion: AGE_CONFIRMATION_VERSION },
    ])
  })

  it('não existe senha no cadastro: campos de senha enviados são ignorados e nunca aparecem no resultado', () => {
    const result = validateSignupPayload(validPayload({ password: 'Numora@2026', confirmPassword: 'Numora@2026' }))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('Numora@2026')
  })

  it('o resultado não carrega metadata jurídica do cliente (terms_accepted, age18 etc.)', () => {
    const result = validateSignupPayload(validPayload({ terms_accepted: true, age18: true, user_metadata: { terms_accepted: 'forjada' } }))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/forjada|terms_accepted|age18\b/)
  })

  it('marketing NÃO é obrigatório: ausente, false ou valor não booleano → cadastro válido, sem marketing', () => {
    for (const marketingOptIn of [undefined, false, null, 'true', 1, 'on']) {
      const result = validateSignupPayload(validPayload({ marketingOptIn }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.marketingOptIn).toBe(false)
        expect(result.data.consents.map((c) => c.documentType)).not.toContain('marketing_email')
      }
    }
  })

  it('marketing só conta com `true` estrito e vira consentimento SEPARADO', () => {
    const result = validateSignupPayload(validPayload({ marketingOptIn: true }))
    expect(result.ok && result.data.consents.find((c) => c.documentType === 'marketing_email')).toEqual({
      documentType: 'marketing_email',
      documentVersion: MARKETING_OPT_IN_VERSION,
    })
  })

  it('apara nome e e-mail', () => {
    const result = validateSignupPayload(validPayload({ name: '  Maria  ', email: ' maria@example.com ' }))
    expect(result.ok && [result.data.name, result.data.email]).toEqual(['Maria', 'maria@example.com'])
  })
})

describe('validateSignupPayload — V1 somente Brasil (validação no servidor)', () => {
  it('a constante da V1 é BR', () => {
    expect(SIGNUP_ALLOWED_COUNTRY).toBe('BR')
  })

  it.each([undefined, null, ''])('país ausente (%j) → country_required', (countryCode) => {
    expect(validateSignupPayload(validPayload({ countryCode }))).toEqual({ ok: false, code: 'country_required' })
  })

  it.each(['US', 'PT', 'AR', 'br', 'BRA', 'B', 'Brasil', 'BR ', ' BR', '1R', 55, { code: 'BR' }, ['BR'], true])(
    'qualquer valor que não seja exatamente "BR" (%j) → country_invalid',
    (countryCode) => {
      expect(validateSignupPayload(validPayload({ countryCode }))).toEqual({ ok: false, code: 'country_invalid' })
    },
  )
})

describe('validateSignupPayload — Termos, Privacidade e 18+ obrigatórios', () => {
  it.each([false, undefined, null, 'true', 1, 'on', 0])('termsAccepted=%j → terms_required', (value) => {
    expect(validateSignupPayload(validPayload({ termsAccepted: value }))).toEqual({ ok: false, code: 'terms_required' })
  })

  it.each([false, undefined, null, 'true', 1])('privacyAccepted=%j → privacy_required', (value) => {
    expect(validateSignupPayload(validPayload({ privacyAccepted: value }))).toEqual({ ok: false, code: 'privacy_required' })
  })

  it.each([false, undefined, null, 'true', 1, 'yes'])('age18Confirmed=%j → age_confirmation_required (nunca confia em valor não booleano)', (value) => {
    expect(validateSignupPayload(validPayload({ age18Confirmed: value }))).toEqual({ ok: false, code: 'age_confirmation_required' })
  })

  it('os nomes de campo antigos (acceptTerms/ageConfirmed) NÃO satisfazem a validação', () => {
    const legacy = validPayload({ termsAccepted: undefined, privacyAccepted: undefined, age18Confirmed: undefined, acceptTerms: true, acceptPrivacy: true, ageConfirmed: true })
    expect(validateSignupPayload(legacy)).toEqual({ ok: false, code: 'terms_required' })
  })

  it.each([
    ['termsVersion ausente', { termsVersion: undefined }],
    ['termsVersion antiga', { termsVersion: '2020-01-01' }],
    ['privacyVersion ausente', { privacyVersion: undefined }],
    ['privacyVersion vazia', { privacyVersion: '' }],
    ['ageConfirmationVersion ausente', { ageConfirmationVersion: undefined }],
    ['ageConfirmationVersion antiga', { ageConfirmationVersion: '0' }],
    ['versão não string', { termsVersion: 20260925 }],
  ])('%s → documents_outdated (versão inválida/antiga nunca vira aceite)', (_label, overrides) => {
    expect(validateSignupPayload(validPayload(overrides))).toEqual({ ok: false, code: 'documents_outdated' })
  })
})

describe('validateSignupPayload — demais campos', () => {
  it.each([null, undefined, 'x', 42, [], true])('corpo não-objeto (%j) → invalid_body', (payload) => {
    expect(validateSignupPayload(payload)).toEqual({ ok: false, code: 'invalid_body' })
  })

  it.each([undefined, '', '   ', 5])('nome ausente/vazio (%j) → name_required', (name) => {
    expect(validateSignupPayload(validPayload({ name }))).toEqual({ ok: false, code: 'name_required' })
  })

  it('nome longo demais ou com caractere de controle → name_invalid', () => {
    expect(validateSignupPayload(validPayload({ name: 'a'.repeat(101) }))).toEqual({ ok: false, code: 'name_invalid' })
    expect(validateSignupPayload(validPayload({ name: 'Maria\u0000' }))).toEqual({ ok: false, code: 'name_invalid' })
  })

  it.each([undefined, '', 'sem-arroba', 'a@b', 'a b@c.com', 5, `${'a'.repeat(250)}@x.com`])('e-mail inválido (%j) → email_invalid', (email) => {
    expect(validateSignupPayload(validPayload({ email }))).toEqual({ ok: false, code: 'email_invalid' })
  })

  it('nenhuma mensagem de erro contém e-mail ou dado digitado', () => {
    for (const message of Object.values(SIGNUP_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/@example\.com|Maria/)
    }
  })

  it('o resultado de falha nunca carrega o valor digitado', () => {
    const result = validateSignupPayload(validPayload({ name: '', email: 'segredo@example.com' }))
    expect(JSON.stringify(result)).not.toContain('segredo')
  })
})
