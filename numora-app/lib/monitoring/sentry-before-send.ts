/**
 * lib/monitoring/sentry-before-send.ts
 * Etapa "Sentry + tratamento global de erros" — scrubber compartilhado
 * pelos 3 pontos de `Sentry.init()` (client/server/edge). Defesa em
 * profundidade: a auditoria desta etapa não encontrou nenhum caminho de
 * erro hoje que vaze senha/token/service_role/cookie (todo repositório só
 * lança `error.message`, nunca o objeto bruto do driver) — mas nenhuma
 * captura futura deve depender de "hoje não vaza" continuar verdadeiro.
 *
 * Remove, recursivamente, qualquer chave cujo nome bata no padrão abaixo
 * de `request.headers`/`request.data`/`extra`/`contexts` do evento, e
 * descarta `request.cookies` por completo (nunca redigido parcialmente —
 * o cookie de sessão do Supabase não tem nenhum valor de debug que
 * justifique manter mesmo mascarado).
 */
import type { ErrorEvent } from '@sentry/nextjs'

const SENSITIVE_KEY_PATTERN = /password|senha|token|secret|service_role|authorization|cookie/i
const REDACTED = '[REDACTED]'

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub)
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrub(entry)
    }
    return result
  }

  return value
}

export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.headers) {
      event.request.headers = scrub(event.request.headers) as Record<string, string>
    }
    if (event.request.cookies) {
      delete event.request.cookies
    }
    if (event.request.data) {
      event.request.data = scrub(event.request.data)
    }
  }

  if (event.extra) {
    event.extra = scrub(event.extra) as ErrorEvent['extra']
  }

  if (event.contexts) {
    event.contexts = scrub(event.contexts) as ErrorEvent['contexts']
  }

  return event
}
