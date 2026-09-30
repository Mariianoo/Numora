/**
 * lib/captcha/captcha.ts
 * Etapa "B2 — Signup + Legal" / "B2.4" — abstração de CAPTCHA (Cloudflare
 * Turnstile).
 *
 * DOIS CAMINHOS, um mecanismo de coleta:
 * - LOGIN e RECUPERAÇÃO DE SENHA (browser → GoTrue): o app só coleta o token
 *   e o repassa como `captchaToken`; a verificação é do Supabase Auth
 *   (Attack Protection) — não há secret no código desse caminho.
 * - CADASTRO PÚBLICO (B2.4): o servidor cria o usuário pela Admin API, que o
 *   CAPTCHA nativo do GoTrue NÃO protege. Por isso o token é verificado no
 *   NOSSO servidor (lib/captcha/turnstile-server.ts) com a secret
 *   `TURNSTILE_SECRET_KEY` — só servidor, nunca no bundle, log, Sentry ou
 *   resposta.
 *
 * Um token Turnstile é de uso único; cada widget (login, reset, cadastro)
 * emite o seu.
 *
 * Desligado por padrão: sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` nada muda em
 * login/reset. A site key é pública por definição (aparece no bundle).
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
 * (ou secret sem chave pública) é configuração quebrada — nunca "meio ligado".
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
 * Regra de segurança de ambiente: em Production (Vercel) o cadastro nunca
 * pode ficar aberto SEM CAPTCHA configurado — nada de "CAPTCHA fake".
 */
export function isCaptchaRequirementMet(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === 'production') {
    return checkTurnstileServerConfig(env).state === 'enabled'
  }
  return checkTurnstileServerConfig(env).state !== 'misconfigured'
}
