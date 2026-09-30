/**
 * lib/auth/signup-nonce.ts
 * Etapa "B2.4.1 — Hardening de ownership" — `signup_attempt_nonce`: valor
 * criptograficamente aleatório, gerado EXCLUSIVAMENTE no servidor, UMA vez por
 * tentativa de cadastro. É gravado em `app_metadata` (server-only) no ato da
 * criação atômica da conta (`admin.createUser`) e é a ÚNICA prova aceita de
 * que um usuário pertence ao request que está agindo sobre ele:
 * - antes de gravar `legal_consents` ou enviar e-mail;
 * - antes de qualquer rollback destrutivo (`deleteUser`).
 *
 * Nunca é enviado ao navegador, registrado em log ou enviado ao Sentry.
 */
import { randomBytes } from 'node:crypto'

export function generateAttemptNonce(): string {
  return randomBytes(24).toString('base64url')
}
