/**
 * features/profile/username.ts
 * Validação de formato de username — somente na aplicação nesta etapa
 * (Etapa 8.1); não há CHECK constraint no banco (decisão explícita, para
 * não alterar schema/migrations nesta etapa). A única garantia de banco
 * quanto a este campo é a UNIQUE constraint (`uq_profiles_username`),
 * já existente.
 */

const USERNAME_PATTERN = /^[a-z_][a-z0-9_]{2,19}$/

/** Remove espaços nas pontas e força minúsculas — nunca rejeita por causa disso, só normaliza. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Retorna a mensagem de erro, ou `null` se o formato for válido. Espera um valor já normalizado. */
export function validateUsernameFormat(username: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use de 3 a 20 caracteres: letras minúsculas, números e "_", sem começar com número.'
  }
  return null
}
