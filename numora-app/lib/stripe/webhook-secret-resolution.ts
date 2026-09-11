/**
 * lib/stripe/webhook-secret-resolution.ts
 * Etapa "5.10Q-A — Live Billing Guards" — escolha do signing secret
 * correto por modo (5.10O §7: o formato `whsec_...` é idêntico entre
 * TEST/LIVE, então NUNCA é possível inferir o modo pelo valor do secret
 * — só por qual variável foi configurada).
 *
 * Pura — recebe os dois valores já lidos do ambiente (nunca lê
 * `process.env` sozinha, mesmo padrão dos outros contratos desta etapa).
 * Requisito absoluto (5.10O): NUNCA um fallback silencioso entre modos —
 * `mode:'live'` sem `liveSecret` configurado nunca "cai" para
 * `testSecret`, mesmo que este esteja presente, e vice-versa.
 *
 * Validação de FORMATO (`whsec_...`) é responsabilidade do chamador
 * (`assertStripeWebhookSecretFormat`, já existente) — este módulo só
 * resolve QUAL dos dois usar, nunca revalida o formato (mantém o
 * contrato exatamente como testado em
 * `tests/unit/webhook-secret-resolution-contract.test.ts`).
 */
export interface ResolveExpectedWebhookSecretParams {
  mode: 'test' | 'live'
  testSecret: string | undefined
  liveSecret: string | undefined
}

export function resolveExpectedWebhookSecret(params: ResolveExpectedWebhookSecretParams): string {
  const secret = params.mode === 'test' ? params.testSecret : params.liveSecret

  if (!secret || secret.trim().length === 0) {
    throw new Error(
      `[resolveExpectedWebhookSecret] Nenhum secret de webhook configurado para o modo "${params.mode}" — nunca usa o secret do outro modo como fallback (fail-closed).`,
    )
  }

  return secret
}
