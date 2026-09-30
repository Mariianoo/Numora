/**
 * lib/legal/versions.ts
 * Etapa "B2 — Signup + Legal" — FONTE ÚNICA de versão dos documentos legais
 * e das declarações de consentimento. Atualizar a versão de um documento é
 * mudar UMA constante aqui; nenhum outro arquivo hardcoda versão.
 *
 * Os identificadores de versão são só rótulos estáveis (data de vigência
 * ISO). Nenhum conteúdo jurídico definitivo é definido neste arquivo — o
 * texto dos documentos continua nas páginas públicas e está marcado como
 * PENDENTE DE REVISÃO JURÍDICA até o jurídico aprová-lo. Quando o texto
 * definitivo for aprovado, ajuste a versão/vigência/status abaixo.
 *
 * Módulo puro (sem I/O) — seguro para importar do servidor e do browser.
 */

export const TERMS_VERSION = '2026-09-25'
export const PRIVACY_VERSION = '2026-09-25'
export const COOKIES_VERSION = '2026-09-25'
/** Versão do texto exato da declaração de maioridade (AGE_CONFIRMATION_TEXT). */
export const AGE_CONFIRMATION_VERSION = '1'
/** Versão do texto exato do opt-in de marketing (MARKETING_OPT_IN_TEXT). */
export const MARKETING_OPT_IN_VERSION = '1'

/** Texto exato exigido pela decisão de produto — não reescrever sem nova aprovação. */
export const AGE_CONFIRMATION_TEXT = 'Confirmo que tenho 18 anos ou mais.'
export const MARKETING_OPT_IN_TEXT = 'Quero receber novidades e comunicações de marketing do Numora por e-mail.'

export type LegalDocumentType = 'terms' | 'privacy' | 'cookies' | 'age_18' | 'marketing_email'

/** Tipos aceitos por `legal_consents.document_type` (mesma lista do CHECK da migration). */
export const LEGAL_DOCUMENT_TYPES: readonly LegalDocumentType[] = ['terms', 'privacy', 'cookies', 'age_18', 'marketing_email']

export type LegalReviewStatus = 'pending_legal_review' | 'approved'

export interface LegalDocumentInfo {
  type: LegalDocumentType
  version: string
  /** Data de vigência (ISO, YYYY-MM-DD) desta versão. */
  effectiveDate: string
  reviewStatus: LegalReviewStatus
  /** Sempre `true` para a versão aqui registrada — a única versão vigente. */
  isCurrent: true
}

export const LEGAL_DOCUMENTS = {
  terms: { type: 'terms', version: TERMS_VERSION, effectiveDate: '2026-09-25', reviewStatus: 'pending_legal_review', isCurrent: true },
  privacy: { type: 'privacy', version: PRIVACY_VERSION, effectiveDate: '2026-09-25', reviewStatus: 'pending_legal_review', isCurrent: true },
  cookies: { type: 'cookies', version: COOKIES_VERSION, effectiveDate: '2026-09-25', reviewStatus: 'pending_legal_review', isCurrent: true },
} as const satisfies Record<'terms' | 'privacy' | 'cookies', LegalDocumentInfo>

/** Formato aceito de versão (mesma regex do CHECK de `legal_consents.document_version`). */
export const LEGAL_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/

export function isValidLegalVersion(value: unknown): value is string {
  return typeof value === 'string' && LEGAL_VERSION_PATTERN.test(value)
}

/**
 * Versão vigente de um tipo de consentimento. Lança se o tipo não tiver
 * versão registrada ou se a versão registrada for malformada — nunca
 * devolve string vazia/undefined (fail-safe: o cadastro não pode registrar
 * aceite "sem versão").
 */
export function getCurrentLegalVersion(type: LegalDocumentType): string {
  const versions: Record<LegalDocumentType, string | undefined> = {
    terms: TERMS_VERSION,
    privacy: PRIVACY_VERSION,
    cookies: COOKIES_VERSION,
    age_18: AGE_CONFIRMATION_VERSION,
    marketing_email: MARKETING_OPT_IN_VERSION,
  }

  const version = versions[type]
  if (!isValidLegalVersion(version)) {
    throw new Error(`[legal/versions] Versão ausente ou inválida para o documento "${String(type)}".`)
  }
  return version
}

/** `true` só quando `version` é exatamente a versão vigente do tipo (aceite de versão antiga/desconhecida é rejeitado). */
export function isCurrentLegalVersion(type: LegalDocumentType, version: unknown): boolean {
  if (!isValidLegalVersion(version)) return false
  try {
    return getCurrentLegalVersion(type) === version
  } catch {
    return false
  }
}
