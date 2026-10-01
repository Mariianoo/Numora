/**
 * lib/auth/signup-config.ts
 * Etapa "B2.4 — Signup server-controlled" — configuração e barreiras de
 * ORIGEM do cadastro/confirmação. Módulo puro (sem I/O): recebe o `env` e o
 * `Request`.
 *
 * URL CANÔNICA: `NEXT_PUBLIC_SITE_URL` é a ÚNICA fonte da origem pública
 * usada em links de e-mail, redirects e checagem de Origin. Nunca derivada de
 * `Host`, `X-Forwarded-Host` nem de `request.url`. Ausente/inválida → o
 * fluxo FALHA de forma segura (503), nunca "adivinha" uma origem.
 *
 * ORIGIN/CSRF: o cadastro e a confirmação são POSTs disparados pelo próprio
 * site; o navegador sempre envia `Origin`. Exigimos que seja exatamente a
 * origem canônica (ausente ou diferente → recusa) e recusamos
 * `Sec-Fetch-Site: cross-site`.
 */
import { resolveSignupCaptchaPolicy } from '@/lib/captcha/captcha'

export type SiteOriginResult = { ok: true; origin: string } | { ok: false }

/**
 * Origem canônica a partir de `NEXT_PUBLIC_SITE_URL`. Em Production
 * (`VERCEL_ENV=production`) exige https; fora dela aceita http só em
 * localhost (desenvolvimento). Path, query e hash são descartados.
 */
export function getCanonicalOrigin(env: Record<string, string | undefined>): SiteOriginResult {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!raw) return { ok: false }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false }
  }

  const isProduction = env.VERCEL_ENV === 'production'
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'

  if (url.protocol === 'https:') {
    return { ok: true, origin: url.origin }
  }
  if (url.protocol === 'http:' && isLocalhost && !isProduction) {
    return { ok: true, origin: url.origin }
  }
  return { ok: false }
}

/** `true` só quando o `Origin` do request é exatamente a origem canônica. */
export function isAllowedRequestOrigin(request: Request, canonicalOrigin: string): boolean {
  const origin = request.headers.get('origin')
  if (!origin || origin !== canonicalOrigin) return false

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite === 'cross-site') return false

  return true
}

export interface EmailConfig {
  apiKey: string
  from: string
}

/** Configuração do Resend. Ausente/incompleta → `null` (o cadastro não abre sem e-mail). */
export function getEmailConfig(env: Record<string, string | undefined>): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.RESEND_FROM_EMAIL?.trim()
  if (!apiKey || !from) return null
  return { apiKey, from }
}

export type SignupConfigResult =
  | { ok: true; origin: string; captcha: 'enabled' | 'disabled'; email: EmailConfig; turnstileSecret: string | null }
  | { ok: false }

/**
 * Tudo que o endpoint precisa para operar com segurança. Qualquer peça
 * ausente ou incoerente → `ok: false` (503 fail-closed):
 * - origem canônica válida;
 * - Resend configurado;
 * - Turnstile: etapa "B2.5.2" — a obrigatoriedade é decidida por
 *   `resolveSignupCaptchaPolicy` (política explícita via `CAPTCHA_REQUIRED`,
 *   nunca mais por `VERCEL_ENV`). Chave pública sem secret (ou o inverso)
 *   continua sendo configuração quebrada, sempre `ok:false`.
 */
export function resolveSignupConfig(env: Record<string, string | undefined>): SignupConfigResult {
  const origin = getCanonicalOrigin(env)
  if (!origin.ok) return { ok: false }

  const email = getEmailConfig(env)
  if (!email) return { ok: false }

  const captcha = resolveSignupCaptchaPolicy(env)
  if (!captcha.ok) return { ok: false }

  return {
    ok: true,
    origin: origin.origin,
    captcha: captcha.state,
    email,
    turnstileSecret: captcha.state === 'enabled' ? captcha.secret : null,
  }
}
