/**
 * lib/auth/signup-validation.ts
 * Etapa "B2 — Signup + Legal" / "B2.4" — validação PURA do payload de
 * cadastro. É a validação crítica e roda no SERVIDOR
 * (lib/auth/signup-handler.ts); o formulário só a espelha para UX. Nada aqui
 * confia no navegador:
 *
 * - NÃO há senha no cadastro (decisão B2.4): a conta nasce com senha aleatória
 *   descartada e o usuário define a real após confirmar o e-mail;
 * - V1 aceita SOMENTE `BR` (mercado inicial) — qualquer outro valor é
 *   rejeitado no servidor;
 * - Termos/Privacidade/18+ exigem `true` estrito E a versão vigente ecoada
 *   pelo cliente (versão ausente/antiga → `documents_outdated`);
 * - os consentimentos a gravar são montados AQUI a partir das constantes de
 *   lib/legal/versions.ts e só o SERVIDOR os grava (lib/legal/signup-consents.ts)
 *   — nenhuma metadata do cliente (terms_accepted, age18 etc.) é prova de aceite;
 * - a metadata enviada ao Supabase só leva dados NÃO jurídicos (nome e país);
 * - nenhum erro devolve o valor digitado.
 */
import { buildSignupConsents, type ConsentToRecord } from '@/lib/legal/signup-consents'
import { isCurrentLegalVersion } from '@/lib/legal/versions'

export const SIGNUP_NAME_MAX_LENGTH = 100
export const SIGNUP_EMAIL_MAX_LENGTH = 254
/** Único país aceito no cadastro público da V1. */
export const SIGNUP_ALLOWED_COUNTRY = 'BR'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COUNTRY_PATTERN = /^[A-Z]{2}$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export type SignupErrorCode =
  | 'invalid_body'
  | 'name_required'
  | 'name_invalid'
  | 'email_invalid'
  | 'country_required'
  | 'country_invalid'
  | 'terms_required'
  | 'privacy_required'
  | 'age_confirmation_required'
  | 'documents_outdated'

export interface ValidatedSignup {
  name: string
  /** Aparado e em minúsculas (o GoTrue normaliza para minúsculas). */
  email: string
  countryCode: string
  marketingOptIn: boolean
  /** Consentimentos que o SERVIDOR gravará após criar a conta (construídos das constantes vigentes). */
  consents: ConsentToRecord[]
}

export type SignupValidation = { ok: true; data: ValidatedSignup } | { ok: false; code: SignupErrorCode }

export const SIGNUP_ERROR_MESSAGES: Record<SignupErrorCode, string> = {
  invalid_body: 'Não foi possível processar o cadastro. Tente novamente.',
  name_required: 'Informe seu nome.',
  name_invalid: 'Nome inválido.',
  email_invalid: 'Informe um e-mail válido.',
  country_required: 'Selecione seu país.',
  country_invalid: 'O cadastro está disponível apenas para o Brasil por enquanto.',
  terms_required: 'É necessário aceitar os Termos de Uso.',
  privacy_required: 'É necessário aceitar a Política de Privacidade.',
  age_confirmation_required: 'É necessário confirmar que você tem 18 anos ou mais.',
  documents_outdated: 'Os documentos legais foram atualizados. Recarregue a página e tente novamente.',
}

function fail(code: SignupErrorCode): SignupValidation {
  return { ok: false, code }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateSignupPayload(payload: unknown): SignupValidation {
  if (!isRecord(payload)) return fail('invalid_body')

  const { name, email, countryCode } = payload

  if (typeof name !== 'string' || name.trim() === '') return fail('name_required')
  const trimmedName = name.trim()
  if (trimmedName.length > SIGNUP_NAME_MAX_LENGTH || CONTROL_CHARS.test(trimmedName)) return fail('name_invalid')

  if (typeof email !== 'string') return fail('email_invalid')
  const trimmedEmail = email.trim()
  if (trimmedEmail.length > SIGNUP_EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(trimmedEmail)) return fail('email_invalid')

  if (countryCode === undefined || countryCode === null || countryCode === '') return fail('country_required')
  if (typeof countryCode !== 'string' || !COUNTRY_PATTERN.test(countryCode) || countryCode !== SIGNUP_ALLOWED_COUNTRY) {
    return fail('country_invalid')
  }

  if (payload.termsAccepted !== true) return fail('terms_required')
  if (payload.privacyAccepted !== true) return fail('privacy_required')
  if (payload.age18Confirmed !== true) return fail('age_confirmation_required')

  if (
    !isCurrentLegalVersion('terms', payload.termsVersion) ||
    !isCurrentLegalVersion('privacy', payload.privacyVersion) ||
    !isCurrentLegalVersion('age_18', payload.ageConfirmationVersion)
  ) {
    return fail('documents_outdated')
  }

  // Marketing: opcional; só `true` estrito conta (qualquer outra coisa = não).
  const marketingOptIn = payload.marketingOptIn === true

  return {
    ok: true,
    data: {
      name: trimmedName,
      email: trimmedEmail.toLowerCase(),
      countryCode,
      marketingOptIn,
      consents: buildSignupConsents(marketingOptIn),
    },
  }
}
