/**
 * lib/monitoring/capture-auth-error.ts
 * Etapa "B2 — Signup + Legal" — captura de erros críticos de auth
 * (signup/callback) no Sentry SEM dados do usuário. Nunca envia o objeto de
 * erro bruto: só um `Error` novo com nome/código/status e mensagem
 * sanitizada (e-mails removidos). Nunca recebe senha, token de CAPTCHA,
 * cookies ou o corpo da requisição.
 *
 * Sem DSN configurado (caso de Production hoje) `Sentry.captureException`
 * é um no-op — nada aqui quebra sem DSN. O scrubber compartilhado
 * (lib/monitoring/sentry-before-send.ts) continua como segunda camada.
 */
import * as Sentry from '@sentry/nextjs'

export type AuthErrorContext =
  | 'signup'
  | 'signup_consent'
  | 'signup_captcha'
  | 'signup_email'
  | 'signup_config'
  | 'signup_rate_limit'
  | 'signup_cleanup'
  | 'auth_confirm'
  | 'auth_callback'
  | 'auth_callback_profile'

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const MAX_MESSAGE_LENGTH = 200

export function sanitizeErrorMessage(message: unknown): string {
  if (typeof message !== 'string') return 'erro desconhecido'
  return message.replace(EMAIL_PATTERN, '[email]').slice(0, MAX_MESSAGE_LENGTH)
}

export function captureAuthError(context: AuthErrorContext, error: unknown, meta?: { requestId?: string }): void {
  const source = (error ?? {}) as { name?: unknown; code?: unknown; status?: unknown; message?: unknown }
  const code = typeof source.code === 'string' ? source.code.slice(0, 64) : undefined
  const status = typeof source.status === 'number' ? source.status : undefined

  const safeError = new Error(sanitizeErrorMessage(source.message))
  safeError.name = typeof source.name === 'string' ? source.name.slice(0, 64) : 'AuthError'

  Sentry.captureException(safeError, {
    tags: {
      auth_context: context,
      ...(code ? { auth_error_code: code } : {}),
      ...(meta?.requestId ? { request_id: meta.requestId.slice(0, 64) } : {}),
    },
    extra: status !== undefined ? { status } : undefined,
  })
}
