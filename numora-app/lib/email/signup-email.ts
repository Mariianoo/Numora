/**
 * lib/email/signup-email.ts
 * Etapa "B2.4 — Signup server-controlled" — e-mail de confirmação do
 * cadastro. O link aponta SEMPRE para a origem canônica do Numora (nunca para
 * o domínio do Supabase) e leva o `token_hash` — uma CREDENCIAL: nunca logar.
 *
 * O link abre uma página com um botão (/auth/confirm); a verificação só
 * acontece no POST, para que scanners de e-mail que fazem GET não consumam o
 * token. O e-mail NÃO inclui texto digitado por quem pediu o cadastro (nome):
 * o destinatário pode ser outra pessoa. Texto sem conteúdo jurídico novo e sem
 * promessas de compliance.
 */
import type { OutgoingEmail } from '@/lib/email/resend'

export const CONFIRM_PATH = '/auth/confirm'
export const CONFIRM_TOKEN_TYPE = 'signup'

/** Formato aceito do `token_hash` (hex/base64url/ponto/hífen), com limites de tamanho. */
export const TOKEN_HASH_PATTERN = /^[A-Za-z0-9._-]{8,512}$/

export function buildConfirmationUrl(origin: string, tokenHash: string): string {
  const url = new URL(CONFIRM_PATH, origin)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', CONFIRM_TOKEN_TYPE)
  return url.toString()
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildSignupConfirmationEmail(input: { to: string; confirmationUrl: string; idempotencyKey: string }): OutgoingEmail {
  const url = input.confirmationUrl

  return {
    to: input.to,
    idempotencyKey: input.idempotencyKey,
    subject: 'Confirme seu e-mail no Numora',
    text: [
      'Olá.',
      '',
      'Recebemos um pedido de cadastro no Numora com este e-mail.',
      'Para confirmar o e-mail e definir sua senha, abra o link abaixo:',
      '',
      url,
      '',
      'O link vale por tempo limitado e só pode ser usado uma vez.',
      'Se você não pediu este cadastro, ignore esta mensagem.',
    ].join('\n'),
    html: [
      '<p>Olá.</p>',
      '<p>Recebemos um pedido de cadastro no Numora com este e-mail. Para confirmar o e-mail e definir sua senha, use o botão abaixo:</p>',
      `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#c9a227;color:#111;text-decoration:none;border-radius:8px;font-weight:600">Confirmar meu e-mail</a></p>`,
      `<p style="font-size:12px;color:#666">Se o botão não funcionar, copie e cole este endereço no navegador:<br>${escapeHtml(url)}</p>`,
      '<p style="font-size:12px;color:#666">O link vale por tempo limitado e só pode ser usado uma vez. Se você não pediu este cadastro, ignore esta mensagem.</p>',
    ].join('\n'),
  }
}
