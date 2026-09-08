/**
 * lib/stripe/idempotency.ts
 * Etapa "Stripe 4.1A" — resolução idempotente de Product/Price já
 * existentes. Funções PURAS: recebem uma lista de candidatos já obtida
 * (a futura Stripe 4.1B chama `stripe.products.search(...)`/
 * `stripe.prices.list({lookup_keys:[...]})` e passa o resultado aqui) —
 * nenhuma chamada ao Stripe acontece neste arquivo nem em nenhum outro
 * desta etapa.
 *
 * Regra absoluta (Stripe 4.0/4.1A): nunca escolher arbitrariamente entre
 * múltiplos candidatos. Exatamente 1 correspondência → reutiliza. 0 → cria
 * (fora desta etapa). Mais de 1 → erro explícito, exige intervenção
 * humana — nunca "pega o primeiro".
 */
export type IdempotentResolution =
  | { status: 'not_found' }
  | { status: 'found'; id: string }
  | { status: 'conflict'; matchingIds: string[] }

export interface StripeProductCandidate {
  id: string
  metadata: Record<string, string | undefined>
}

/** Resolve por `metadata.numora_plan_slug` — Product não tem `lookup_key` no Stripe. */
export function resolveExistingProduct(candidates: StripeProductCandidate[], planSlug: string): IdempotentResolution {
  const matches = candidates.filter((candidate) => candidate.metadata.numora_plan_slug === planSlug)

  if (matches.length === 0) return { status: 'not_found' }
  if (matches.length === 1) return { status: 'found', id: matches[0].id }
  return { status: 'conflict', matchingIds: matches.map((match) => match.id) }
}

export interface StripePriceCandidate {
  id: string
  lookupKey: string | null
}

/** Resolve por `lookup_key` exato. */
export function resolveExistingPrice(candidates: StripePriceCandidate[], lookupKey: string): IdempotentResolution {
  const matches = candidates.filter((candidate) => candidate.lookupKey === lookupKey)

  if (matches.length === 0) return { status: 'not_found' }
  if (matches.length === 1) return { status: 'found', id: matches[0].id }
  return { status: 'conflict', matchingIds: matches.map((match) => match.id) }
}

/**
 * Idempotency-Key determinística para uma chamada de criação — a mesma
 * combinação (tipo de recurso + identificador local) sempre produz a
 * mesma chave, então reenviar a mesma chamada (ex.: depois de uma
 * interrupção) nunca cria um segundo recurso no Stripe, mesmo sem
 * depender só da checagem por lookup_key/metadata acima.
 */
export function buildCreationIdempotencyKey(resourceType: 'product' | 'price' | 'customer' | 'checkout-session', localIdentifier: string): string {
  return `numora:create-${resourceType}:${localIdentifier}`
}
