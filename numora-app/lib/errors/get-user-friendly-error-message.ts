/**
 * lib/errors/get-user-friendly-error-message.ts
 * Função pura, sem I/O (Etapa 12.4) — traduz um erro técnico (rede,
 * Postgres/PostgREST, Storage, ou qualquer `Error` já lançado por um
 * repository) para uma mensagem segura em PT-BR. Nunca deve devolver:
 * nome de repository entre colchetes, código Postgres/PostgREST, mensagem
 * de driver em inglês, ou qualquer detalhe de infraestrutura — esses
 * detalhes continuam disponíveis em `error.message`/`console.error` para
 * debug, só não devem chegar à tela.
 *
 * Mensagens de validação/negócio já curadas (ex.: "Este nome de usuário
 * já está em uso.", a mensagem de "último exemplar" vinda do banco, a
 * saída de `mapAuthErrorMessage`) nunca têm o prefixo `[XRepository]` OU,
 * quando têm, não embutem um erro bruto do driver depois de ": " — por
 * isso passam por aqui praticamente inalteradas (só o prefixo interno, se
 * houver, é removido, já que ele expõe o nome interno do repository).
 */

export const GENERIC_ERROR_MESSAGE = 'Ocorreu um problema inesperado. Tente novamente.'

const NETWORK_ERROR_MESSAGE = 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.'
const AUTH_ERROR_MESSAGE = 'Sua sessão expirou. Faça login novamente.'
const PERMISSION_ERROR_MESSAGE = 'Você não tem permissão para realizar esta ação.'

const NETWORK_PATTERN = /failed to fetch|networkerror|load failed|err_internet_disconnected|err_connection|net::err_/i
const AUTH_PATTERN = /jwt expired|invalid jwt|jws error|not authenticated|refresh_token_not_found/i
const PERMISSION_PATTERN = /permission denied for|row-level security/i
// Fragmentos reconhecíveis de mensagens técnicas do Postgres/PostgREST —
// nunca tentamos exibi-los, mesmo que cheguem sem o prefixo `[XRepository]`.
const POSTGRES_TECHNICAL_PATTERN =
  /pgrst\d+|duplicate key value|violates (foreign key|check|not-null) constraint|invalid input syntax|relation ".*" does not exist|column ".*" does not exist|syntax error at or near/i

// Convenção usada por todos os repositories (`[CollectionRepository] Falha ao X: ...`).
const INTERNAL_PREFIX_PATTERN = /^\[[\w.-]+\]\s*/

/**
 * Traduz um erro para uma mensagem segura de exibir ao usuário.
 * `fallback` é usado quando a mensagem original não é reconhecida como seguro
 * nem como um dos padrões técnicos conhecidos — por padrão, uma mensagem
 * genérica; chamadores como `mapAuthErrorMessage` podem passar o próprio
 * `error.message` como fallback quando ele já é confiável por outros meios.
 */
export function getUserFriendlyErrorMessage(error: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  if (error instanceof TypeError && NETWORK_PATTERN.test(error.message)) {
    return NETWORK_ERROR_MESSAGE
  }

  // Defensivo: hoje nenhum repository propaga `status`/`statusCode` (todos
  // relançam como `Error` simples), mas se algum dia um erro cru do
  // fetch/SDK chegar até aqui com esses campos, já tratamos.
  const statusCandidate = error as { status?: number; statusCode?: number } | null | undefined
  const status = statusCandidate?.status ?? statusCandidate?.statusCode
  if (status === 401) return AUTH_ERROR_MESSAGE
  if (status === 403) return PERMISSION_ERROR_MESSAGE
  if (typeof status === 'number' && status >= 500) return GENERIC_ERROR_MESSAGE

  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (rawMessage === '') return fallback

  if (NETWORK_PATTERN.test(rawMessage)) return NETWORK_ERROR_MESSAGE
  if (AUTH_PATTERN.test(rawMessage)) return AUTH_ERROR_MESSAGE
  if (PERMISSION_PATTERN.test(rawMessage)) return PERMISSION_ERROR_MESSAGE
  if (POSTGRES_TECHNICAL_PATTERN.test(rawMessage)) return GENERIC_ERROR_MESSAGE

  const withoutInternalPrefix = rawMessage.replace(INTERNAL_PREFIX_PATTERN, '')

  // "[XRepository] Falha ao Y: <erro bruto do driver>" — o prefixo interno
  // some acima, mas o que sobra ainda embute um erro técnico não
  // reconhecido por nenhum padrão específico; mais seguro nunca mostrar.
  if (INTERNAL_PREFIX_PATTERN.test(rawMessage) && withoutInternalPrefix.includes(': ')) {
    return fallback
  }

  return withoutInternalPrefix || fallback
}
