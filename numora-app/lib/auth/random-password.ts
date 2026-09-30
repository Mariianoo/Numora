/**
 * lib/auth/random-password.ts
 * Etapa "B2.4 — Signup server-controlled" — senha ALEATÓRIA gerada só no
 * servidor para criar a conta pendente (o `generateLink(type=signup)` exige
 * uma senha). O usuário NUNCA a conhece: ela nunca é exibida, armazenada,
 * registrada, enviada ao Sentry nem devolvida em resposta — existe apenas na
 * memória de uma requisição e é descartada assim que o GoTrue a recebe. O
 * usuário define a senha REAL depois de confirmar o e-mail (updateUser).
 *
 * Usa `crypto.randomBytes` (CSPRNG). O sufixo garante as 4 classes de
 * caracteres caso o projeto exija política de senha no GoTrue.
 */
import { randomBytes } from 'node:crypto'

export function generateDiscardedPassword(): string {
  return `${randomBytes(36).toString('base64url')}Aa1!`
}
