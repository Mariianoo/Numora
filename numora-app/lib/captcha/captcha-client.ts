/**
 * lib/captcha/captcha-client.ts
 * Etapa "B2.1 — Hardening" — leitura da site key do Turnstile NO NAVEGADOR.
 *
 * O Next.js só substitui `process.env.NEXT_PUBLIC_*` no bundle do cliente
 * quando a variável é acessada de forma LITERAL (`process.env.NOME`); o
 * `env = process.env` dos helpers de lib/captcha/captcha.ts (usados no
 * servidor e nos testes) não seria inlinado. Por isso o acesso literal vive
 * aqui, em um único lugar, e só a site key PÚBLICA é lida — nunca uma secret
 * (a verificação do token é do Supabase Auth; ver lib/captcha/captcha.ts).
 *
 * Sem a variável: `null` → nenhum widget, nenhum script externo, e login/
 * reset se comportam exatamente como antes da B2.
 */
export const CLIENT_TURNSTILE_SITE_KEY: string | null = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null
