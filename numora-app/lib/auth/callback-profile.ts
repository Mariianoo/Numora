/**
 * lib/auth/callback-profile.ts
 * Etapa "B2 — Signup + Legal" — decisões PURAS sobre o que o callback de
 * auth pode sincronizar no `profiles` a partir da metadata do usuário.
 *
 * Contexto: desde B2, `handle_new_user()` já grava país/nome/e-mail na
 * CRIAÇÃO do usuário; o callback (troca PKCE) deixou de ser o único
 * caminho do país. Ele agora só COMPLETA o que faltar, sem nunca:
 * - sobrescrever um país já definido (o usuário pode tê-lo editado);
 * - apagar o nome quando a metadata não traz um (ex.: usuário criado pela
 *   Admin API sem nome);
 * - deixar um valor de país inválido derrubar a atualização de nome/e-mail
 *   (por isso o país é um UPDATE separado, condicional a `country_code IS
 *   NULL`, e o resultado é tratado à parte).
 *
 * Nada aqui confia na metadata: formato ISO alfa-2 maiúsculo; a existência
 * do país em `countries` é garantida pela FK do banco (falha é tratada e
 * reportada sem dados do usuário).
 */

const COUNTRY_PATTERN = /^[A-Z]{2}$/
const NAME_MAX_LENGTH = 100

export interface CallbackProfileFields {
  /** Campos seguros para o UPDATE de nome/e-mail (só chaves com valor válido). */
  base: { email?: string; name?: string }
  /** País a preencher SE o profile ainda não tiver um; `null` = nada a fazer. */
  countryToFill: string | null
}

export function resolveCallbackProfileFields(user: { email?: string | null; user_metadata?: unknown }): CallbackProfileFields {
  const metadata = (typeof user.user_metadata === 'object' && user.user_metadata !== null ? user.user_metadata : {}) as Record<string, unknown>

  const base: CallbackProfileFields['base'] = {}
  if (typeof user.email === 'string' && user.email !== '') {
    base.email = user.email
  }

  const rawName = metadata.name ?? metadata.full_name
  if (typeof rawName === 'string') {
    const name = rawName.trim()
    if (name !== '' && name.length <= NAME_MAX_LENGTH) {
      base.name = name
    }
  }

  const rawCountry = metadata.country_code
  const countryToFill = typeof rawCountry === 'string' && COUNTRY_PATTERN.test(rawCountry) ? rawCountry : null

  return { base, countryToFill }
}
