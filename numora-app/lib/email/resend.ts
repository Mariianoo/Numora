/**
 * lib/email/resend.ts
 * Etapa "B2.4 — Signup server-controlled" — envio de e-mail transacional via
 * Resend (API HTTP, sem SDK/dependência nova). SÓ servidor.
 *
 * Regras:
 * - a API key vem por parâmetro (nunca lida aqui de `process.env`);
 * - NUNCA registra/retorna o corpo do e-mail (contém o link de confirmação,
 *   que é uma credencial), o destinatário ou a API key;
 * - erros viram `EmailSendError` com categoria e status HTTP — mensagem fixa;
 * - `Idempotency-Key` (24h no Resend) evita duplicar o envio em reenvio da
 *   mesma tentativa.
 */
const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_TIMEOUT_MS = 8000

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
  /** Único por tentativa de cadastro (até 256 caracteres). */
  idempotencyKey: string
}

export class EmailSendError extends Error {
  readonly status: number | null
  readonly category: 'rejected' | 'unavailable'

  constructor(category: 'rejected' | 'unavailable', status: number | null) {
    super('Falha ao enviar o e-mail transacional.')
    this.name = 'EmailSendError'
    this.category = category
    this.status = status
  }
}

export interface SendEmailOptions {
  apiKey: string
  from: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function sendEmail(email: OutgoingEmail, { apiKey, from, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: SendEmailOptions): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch {
    throw new EmailSendError('unavailable', null)
  }

  if (!response.ok) {
    throw new EmailSendError(response.status >= 500 || response.status === 429 ? 'unavailable' : 'rejected', response.status)
  }
}
