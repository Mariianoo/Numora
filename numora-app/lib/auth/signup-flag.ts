/**
 * lib/auth/signup-flag.ts
 * Etapa "B2 — Signup + Legal" — kill-switch do cadastro público. FAIL-CLOSED:
 * só o valor EXATO "true" abre; ausente, vazio, "TRUE", "1", "yes", " true"
 * e qualquer outra coisa mantêm o cadastro fechado. Nunca use `!== "false"`.
 *
 * Variável server-only (sem prefixo NEXT_PUBLIC_): a decisão é tomada no
 * servidor (página /signup e rota POST /api/auth/signup) — o browser nunca
 * decide se o cadastro está aberto.
 *
 * Esta flag controla só o CÓDIGO da aplicação. O Supabase Auth
 * (`disable_signup`) é uma configuração externa independente e continua
 * fechada em Production; abrir uma não abre a outra.
 */

export function isSignupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNUP_ENABLED === 'true'
}
