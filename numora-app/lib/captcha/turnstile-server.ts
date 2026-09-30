/**
 * lib/captcha/turnstile-server.ts
 * Etapa "B2.4 — Signup server-controlled" — verificação SERVER-SIDE do token
 * do Cloudflare Turnstile (`siteverify`). SÓ servidor: recebe a secret por
 * parâmetro; nunca a registra, nunca a devolve, nunca a envia ao Sentry.
 *
 * Resultado de três estados, sem detalhe do Turnstile para o cliente:
 * - `ok`: a Cloudflare validou o token;
 * - `rejected`: token inválido/expirado/reutilizado/não é deste site;
 * - `unavailable`: a verificação não pôde ser feita (rede/timeout/resposta
 *   inesperada). FAIL-CLOSED: o chamador nunca deixa passar nesse caso.
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DEFAULT_TIMEOUT_MS = 5000

export type TurnstileVerdict = 'ok' | 'rejected' | 'unavailable'

export interface VerifyTurnstileOptions {
  token: string
  secret: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function verifyTurnstileToken({ token, secret, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: VerifyTurnstileOptions): Promise<TurnstileVerdict> {
  if (!token || !secret) return 'rejected'

  try {
    const body = new URLSearchParams({ secret, response: token })
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })

    if (!response.ok) return 'unavailable'

    const result = (await response.json()) as { success?: unknown }
    if (result.success === true) return 'ok'
    if (result.success === false) return 'rejected'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}
