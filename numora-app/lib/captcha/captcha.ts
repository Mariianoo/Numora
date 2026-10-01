/**
 * lib/captcha/captcha.ts
 * Etapa "B2 — Signup + Legal" / "B2.4" / "B2.5.2 — Hardening explícito do
 * CAPTCHA" — abstração de CAPTCHA (Cloudflare Turnstile).
 *
 * DOIS CAMINHOS, um mecanismo de coleta:
 * - LOGIN e RECUPERAÇÃO DE SENHA (browser → GoTrue): o app só coleta o token
 *   e o repassa como `captchaToken`; a verificação é do Supabase Auth
 *   (Attack Protection, com a SECRET própria do Supabase, configurada no
 *   dashboard — nunca a nossa) — não há secret nossa nesse caminho.
 * - CADASTRO PÚBLICO (B2.4): o servidor cria o usuário pela Admin API, que o
 *   CAPTCHA nativo do GoTrue NÃO protege. Por isso o token é verificado no
 *   NOSSO servidor (lib/captcha/turnstile-server.ts) com a secret
 *   `TURNSTILE_SECRET_KEY` — só servidor, nunca no bundle, log, Sentry ou
 *   resposta.
 *
 * Um token Turnstile é de uso único; cada widget (login, reset, cadastro)
 * emite o seu.
 *
 * Etapa "B2.5.2": `CAPTCHA_REQUIRED` substitui a dependência IMPLÍCITA de
 * `VERCEL_ENV === 'production'` (removida) por uma política EXPLÍCITA e
 * única: `isCaptchaRequired()`. Server-only (sem prefixo `NEXT_PUBLIC_`) de
 * propósito — o Next.js só inlina variáveis `NEXT_PUBLIC_*` no bundle do
 * cliente, então decidir "é obrigatório?" exige sempre um componente de
 * servidor (nunca o próprio Client Component) — mesmo raciocínio já aplicado
 * a `SIGNUP_ENABLED`. Fail-closed na mesma convenção: só o valor EXATO
 * "true" ativa a obrigatoriedade; ausente, "false", "TRUE" etc. mantêm o
 * comportamento anterior (CAPTCHA opcional, ligado só pela presença das
 * chaves).
 */

/** Limite documentado pela Cloudflare para o tamanho do token. */
export const CAPTCHA_TOKEN_MAX_LENGTH = 2048

export type CaptchaTokenCheck = { ok: true; token: string | undefined } | { ok: false; reason: 'missing' | 'invalid' }

export function getTurnstileSiteKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
  return key ? key : null
}

export function isCaptchaEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getTurnstileSiteKey(env) !== null
}

export type TurnstileServerConfig =
  | { state: 'disabled' }
  | { state: 'enabled'; siteKey: string; secret: string }
  | { state: 'misconfigured' }

/**
 * Estado do Turnstile para o cadastro (servidor). Chave pública SEM secret
 * (ou secret sem chave pública) é configuração quebrada — nunca "meio ligado",
 * independente de `CAPTCHA_REQUIRED`.
 */
export function checkTurnstileServerConfig(env: Record<string, string | undefined> = process.env): TurnstileServerConfig {
  const siteKey = getTurnstileSiteKey(env)
  const secret = env.TURNSTILE_SECRET_KEY?.trim() || null

  if (!siteKey && !secret) return { state: 'disabled' }
  if (siteKey && secret) return { state: 'enabled', siteKey, secret }
  return { state: 'misconfigured' }
}

/**
 * Valida FORMATO do token recebido do navegador:
 * - CAPTCHA desligado → não exige token (e descarta qualquer token enviado);
 * - ligado → token obrigatório, string não vazia, sem espaços, até 2048.
 * Nunca registra/retorna o valor do token além de `token` no caso `ok`.
 */
export function checkCaptchaToken(token: unknown, env: Record<string, string | undefined> = process.env): CaptchaTokenCheck {
  if (!isCaptchaEnabled(env)) {
    return { ok: true, token: undefined }
  }

  if (token === undefined || token === null || token === '') {
    return { ok: false, reason: 'missing' }
  }

  if (typeof token !== 'string' || token.length > CAPTCHA_TOKEN_MAX_LENGTH || /\s/.test(token)) {
    return { ok: false, reason: 'invalid' }
  }

  return { ok: true, token }
}

/**
 * ÚNICA leitura de `CAPTCHA_REQUIRED` — fonte única de verdade da política de
 * obrigatoriedade, usada por signup, login e recuperação de senha. Nunca
 * duplicar esta leitura em outro lugar.
 */
export function isCaptchaRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.CAPTCHA_REQUIRED === 'true'
}

export type SignupCaptchaPolicy =
  | { ok: true; state: 'enabled'; siteKey: string; secret: string }
  | { ok: true; state: 'disabled' }
  | { ok: false }

/**
 * Política de CAPTCHA do CADASTRO (verificação real é NOSSA, com
 * `TURNSTILE_SECRET_KEY` — ver lib/captcha/turnstile-server.ts). Único lugar
 * que decide se o cadastro pode prosseguir sem CAPTCHA:
 * - chave pública sem secret (ou o inverso): SEMPRE `ok:false`, independente
 *   de `CAPTCHA_REQUIRED` — configuração quebrada nunca é "ligada pela metade";
 * - as duas chaves presentes: `enabled`, token passa a ser obrigatório e
 *   verificado, independente de `CAPTCHA_REQUIRED` (mantém o comportamento
 *   já existente: se o operador configurou as chaves, o token é sempre
 *   checado quando enviado);
 * - nenhuma chave e `CAPTCHA_REQUIRED=true`: `ok:false` (fail-closed — nunca
 *   prossegue sem CAPTCHA só porque o ambiente "parece" produção);
 * - nenhuma chave e `CAPTCHA_REQUIRED` ausente/false: `disabled` (mesmo
 *   comportamento de antes do B2.5.2 fora de Production).
 */
export function resolveSignupCaptchaPolicy(env: Record<string, string | undefined> = process.env): SignupCaptchaPolicy {
  const config = checkTurnstileServerConfig(env)
  if (config.state === 'misconfigured') return { ok: false }
  if (config.state === 'enabled') return { ok: true, state: 'enabled', siteKey: config.siteKey, secret: config.secret }
  if (isCaptchaRequired(env)) return { ok: false }
  return { ok: true, state: 'disabled' }
}

export type ClientCaptchaPolicy = { ok: true; required: boolean; siteKey: string | null } | { ok: false }

/**
 * Política de CAPTCHA do LOGIN e da RECUPERAÇÃO DE SENHA. A verificação real
 * do token é do Supabase Auth (secret própria, fora deste código) — aqui só
 * decidimos se a página pode ser exibida e se o token é OBRIGATÓRIO antes do
 * envio. `CAPTCHA_REQUIRED=true` sem a site key pública configurada é
 * fail-closed: a página nunca oferece um formulário que prometeria proteção
 * e não a tem — `ok:false` sinaliza ao Server Component que a tela deve
 * mostrar "indisponível" em vez do formulário.
 */
export function resolveClientCaptchaPolicy(env: Record<string, string | undefined> = process.env): ClientCaptchaPolicy {
  const siteKey = getTurnstileSiteKey(env)
  const required = isCaptchaRequired(env)
  if (required && !siteKey) return { ok: false }
  return { ok: true, required, siteKey }
}
