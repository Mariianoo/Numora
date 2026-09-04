/**
 * features/auth/map-auth-error-message.ts
 * Traduz os códigos de erro conhecidos do Supabase Auth (`error.code`,
 * estável — nunca `error.message`, que é texto em inglês sujeito a
 * mudar) para mensagens em português. Propositalmente NÃO diferencia
 * "e-mail não existe" de "senha errada": o próprio Supabase retorna o
 * mesmo `invalid_credentials` para os dois casos, por segurança contra
 * enumeração de contas — não tentamos ser mais específicos que isso.
 *
 * Extraída de `repositories/auth.repository.ts` (Etapa "F2 — Closed Beta
 * Test Suite") para ser testável sem client Supabase, mesmo padrão já
 * usado por `features/collection/aggregate.ts`. Nenhuma mudança de
 * comportamento, só de localização — inclusive o gap conhecido e já
 * reportado (Etapa "Closed Beta UX"): `signup_disabled` não tem `case`
 * próprio aqui, então cai no fallback e hoje pode devolver a mensagem
 * bruta em inglês do GoTrue. Isso é inofensivo na prática porque `/signup`
 * não chama mais `signUp()` (virou tela informativa de Beta Fechado) — o
 * ramo é código morto pela UI atual. Corrigir isso está fora do escopo
 * desta etapa (só testes, sem mudança de comportamento funcional).
 */
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'

export function mapAuthErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.'
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com este e-mail.'
    case 'weak_password':
      return 'Senha muito fraca. Use pelo menos 8 caracteres.'
    case 'same_password':
      return 'A nova senha precisa ser diferente da atual.'
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
    default:
      // Código não mapeado (ex.: erro de rede antes de chegar ao Supabase,
      // ou algum código novo do SDK) — nunca mostramos error.message bruto
      // direto; o fallback preserva o texto original só quando ele já é
      // seguro (ver getUserFriendlyErrorMessage).
      return getUserFriendlyErrorMessage(new Error(error.message), error.message)
  }
}
