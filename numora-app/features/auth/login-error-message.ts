/**
 * features/auth/login-error-message.ts
 * Etapa "B1 — Official Launch, código de cobrança" — traduz o parâmetro
 * `?error=` que `app/auth/callback/route.ts` anexa ao redirecionar para
 * `/login` (hoje só `auth_callback_failed`) numa mensagem em português.
 *
 * Whitelist ESTRITA: só códigos conhecidos viram mensagem; qualquer outro
 * valor (ausente, vazio, inesperado, tentativa de injeção de texto via URL)
 * devolve `null` e o login se comporta exatamente como antes. A mensagem
 * NUNCA inclui o valor recebido da URL nem qualquer detalhe interno.
 */
const LOGIN_QUERY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  auth_callback_failed: 'Não foi possível concluir a confirmação do seu acesso. Tente entrar novamente ou solicite um novo link.',
}

export function getLoginQueryErrorMessage(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null
  return Object.prototype.hasOwnProperty.call(LOGIN_QUERY_ERROR_MESSAGES, code) ? LOGIN_QUERY_ERROR_MESSAGES[code] : null
}
