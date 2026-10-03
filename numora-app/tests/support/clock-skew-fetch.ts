/**
 * tests/support/clock-skew-fetch.ts
 * Etapa "B2.5.4" — `fetch` de TESTE que repete a requisição SOMENTE para a assinatura exata do
 * clock-skew intermitente observado no DEV: HTTP 401 com corpo
 * `{"code":"PGRST303","message":"JWT issued at future"}`. Essa rejeição acontece na borda do
 * PostgREST ANTES de qualquer função rodar, então repetir é seguro e nada é consumido duas vezes.
 *
 * NÃO repete (propaga/devolve de imediato): qualquer outro status ou código, constraint, erro de
 * RPC, permission denied, timeout, erro de rede, corpo que não seja JSON, resposta válida. Total
 * de tentativas é FINITO (`maxAttempts`, padrão 3 = no máximo 2 repetições).
 */
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_DELAY_MS = 200

export function isClockSkewBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const { code, message } = body as { code?: unknown; message?: unknown }
  return code === 'PGRST303' && typeof message === 'string' && /jwt issued at future/i.test(message)
}

export function createClockSkewRetryingFetch(
  baseFetch: typeof fetch = fetch,
  { maxAttempts = DEFAULT_MAX_ATTEMPTS, delayMs = DEFAULT_DELAY_MS }: { maxAttempts?: number; delayMs?: number } = {},
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await baseFetch(input, init)
      if (response.status !== 401 || attempt >= maxAttempts) return response
      // Só dá para reenviar corpo textual (o supabase-js manda string); qualquer outra coisa segue sem retry.
      if (init?.body != null && typeof init.body !== 'string') return response

      const body: unknown = await response.clone().json().catch(() => null)
      if (!isClockSkewBody(body)) return response
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
