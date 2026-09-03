/**
 * features/coin-composition/errors.ts
 * Traduz os códigos conhecidos da RPC `set_collection_item_composition`
 * (ver `CoinCompositionRepository.setComposition`, que preserva
 * `error.code`) para mensagens amigáveis em PT-BR — mesmo espírito de
 * `mapAuthErrorMessage` (features/auth/repositories/auth.repository.ts),
 * mas para os 4 SQLSTATE definidos na Etapa 2:
 *
 * - 42501: sem permissão (dono não é o usuário logado).
 * - 22023: payload/regra de negócio inválida (soma de percentuais, metal
 *   obrigatório, estrutura body×core/ring etc.) — a RPC já tem uma
 *   mensagem específica por regra, mas nunca a exibimos diretamente (é em
 *   inglês técnico de exceção, não pensada para o usuário final).
 * - 23503: metal inexistente no catálogo.
 * - 23505: metal duplicado na mesma parte.
 *
 * Qualquer código fora desses 4 é "desconhecido" — cai no fallback
 * genérico de `getUserFriendlyErrorMessage`, nunca é mascarado/ignorado.
 */
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'

const COMPOSITION_ERROR_MESSAGES: Record<string, string> = {
  '42501': 'Você não tem permissão para alterar esta moeda.',
  '22023': 'Revise a composição informada.',
  '23503': 'Um dos metais selecionados não está disponível.',
  '23505': 'Este metal já foi adicionado a esta parte.',
}

function getErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null | undefined)?.code
}

/** `true` para os 4 códigos conhecidos (validação/negócio esperada) — `false` para qualquer outro (falha inesperada, digna de log). */
export function isKnownCompositionErrorCode(error: unknown): boolean {
  const code = getErrorCode(error)
  return code !== undefined && code in COMPOSITION_ERROR_MESSAGES
}

export function getCompositionErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code !== undefined && code in COMPOSITION_ERROR_MESSAGES) {
    return COMPOSITION_ERROR_MESSAGES[code]
  }
  return getUserFriendlyErrorMessage(error)
}
