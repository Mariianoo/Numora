/**
 * config/constants.ts
 * Constantes globais de infraestrutura (não-relacionadas a regra de negócio
 * de domínio — essas vivem em config/constants.ts dentro de cada feature,
 * quando necessário, conforme PROJECT_RULES.md §6.4).
 */

export const APP_NAME = 'Numora' as const

export const DEFAULT_LOCALE = 'pt-BR' as const

export const SUPPORTED_LOCALES = ['pt-BR'] as const
// Demais locales (en, es) são adicionados aqui conforme BUSINESS_MODEL.md §21
// avança de fase — a arquitetura de i18n já suporta a extensão (ver
// lib/i18n).

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_PAGE_SIZE = 20 as const
export const MAX_PAGE_SIZE = 100 as const
