/**
 * lib/legal/signup-consents.ts
 * Etapa "B2.1 — Hardening" — ÚNICO caminho de gravação de `legal_consents` no
 * cadastro. Roda SÓ no servidor, com o client `service_role`, DEPOIS de o
 * handler ter validado flag, CAPTCHA, versões vigentes, 18+ e país e de ter
 * confirmado que o usuário acabou de ser criado.
 *
 * Por que não pelo trigger/metadata: a `user_metadata` é enviada por quem
 * chama o Supabase Auth; uma chamada direta ao GoTrue com a anon key pública
 * poderia trazer versões/"18+" forjados. Consentimento gravado a partir dela
 * seria prova falsa. Aqui as linhas são construídas das constantes do
 * servidor (lib/legal/versions.ts), nunca do payload do cliente.
 *
 * Nunca importar de código do navegador (usa o admin client por injeção — o
 * chamador é a rota de servidor).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { AGE_CONFIRMATION_VERSION, MARKETING_OPT_IN_VERSION, PRIVACY_VERSION, TERMS_VERSION, type LegalDocumentType } from '@/lib/legal/versions'

export const SIGNUP_CONSENT_SOURCE = 'signup'

export interface ConsentToRecord {
  documentType: LegalDocumentType
  documentVersion: string
}

/** Consentimentos de um cadastro: obrigatórios sempre; marketing só com opt-in explícito. */
export function buildSignupConsents(marketingOptIn: boolean): ConsentToRecord[] {
  return [
    { documentType: 'terms', documentVersion: TERMS_VERSION },
    { documentType: 'privacy', documentVersion: PRIVACY_VERSION },
    { documentType: 'age_18', documentVersion: AGE_CONFIRMATION_VERSION },
    ...(marketingOptIn ? [{ documentType: 'marketing_email' as const, documentVersion: MARKETING_OPT_IN_VERSION }] : []),
  ]
}

/**
 * Grava os consentimentos de `userId` (append-only). Idempotente por
 * (user, tipo, versão). Lança se o banco recusar — o chamador decide a
 * compensação (o cadastro não pode ficar sem prova de aceite).
 */
export async function recordSignupConsents(admin: SupabaseClient, userId: string, consents: ConsentToRecord[]): Promise<void> {
  const rows = consents.map((consent) => ({
    user_id: userId,
    document_type: consent.documentType,
    document_version: consent.documentVersion,
    source: SIGNUP_CONSENT_SOURCE,
  }))

  const { error } = await admin
    .from('legal_consents')
    .upsert(rows, { onConflict: 'user_id,document_type,document_version', ignoreDuplicates: true })

  if (error) {
    // Mensagem fixa: nunca propaga texto do banco (pode conter valores).
    throw new Error('Falha ao registrar os consentimentos legais do cadastro.')
  }
}
