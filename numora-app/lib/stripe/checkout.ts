/**
 * lib/stripe/checkout.ts
 * Etapa "Stripe 5.3 — Checkout Foundation" — resolução server-side do preço
 * vendável + criação da Stripe Checkout Session. NÃO cria/sincroniza
 * subscription local — isso é responsabilidade futura dos webhooks.
 *
 * `resolveSellablePrice` é PURA (recebe o catálogo já lido por
 * `getCommercialPlanPricesCatalog`, nunca consulta o banco sozinha) — o
 * mesmo padrão de `resolveExistingProduct`/`resolveExistingPrice`
 * (lib/stripe/idempotency.ts) e `reconcilePriceWithStripe`
 * (lib/stripe/reconciliation.ts): nunca escolher arbitrariamente (primeiro/
 * mais barato/mais recente) — exatamente a combinação plan+interval+currency
 * pedida, e só se `active=true`. `getCommercialPlanPricesCatalog` já
 * garante (via `assertNoDuplicateCombinations`) no máximo 1 linha CORRENTE
 * (`effective_until IS NULL`) por combinação — mas essa linha pode estar
 * `active=false` (rascunho agendado, ver Stripe 3.2/3.4); esta função
 * rejeita esse caso explicitamente, nunca vende um preço inativo.
 *
 * `createCheckoutSession` é a única função aqui que chama o Stripe de
 * verdade — sempre recebe um `stripe_price_id`/`stripe_customer_id` já
 * resolvidos pelo SERVIDOR (nunca por parâmetro vindo do cliente).
 */
import type Stripe from 'stripe'
import { z } from 'zod'

import { PAID_PLAN_SLUGS, VALID_CURRENCIES, VALID_INTERVALS, type CommercialPlanPrice, type PaidPlanSlug, type PriceCurrency, type PriceInterval } from './catalog'
import { buildCreationIdempotencyKey } from './idempotency'

/**
 * Contrato do request de `POST /api/billing/checkout` — só parâmetros de
 * NEGÓCIO. `'free'` é aceito SINTATICAMENTE (para dar um erro de negócio
 * específico — "Free não tem Checkout" — em vez de um erro de schema
 * genérico), mas nunca chega a `resolveSellablePrice` (o Route Handler
 * rejeita antes). `priceId`/`stripe_price_id`/`customerId` NUNCA fazem
 * parte deste schema, de propósito — não há campo que o cliente possa usar
 * para escolher o preço/Customer diretamente.
 */
export const checkoutRequestSchema = z.object({
  planSlug: z.enum(['free', ...PAID_PLAN_SLUGS]),
  interval: z.enum(VALID_INTERVALS),
  currency: z.enum(VALID_CURRENCIES),
})

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export interface ResolveSellablePriceParams {
  planSlug: PaidPlanSlug
  interval: PriceInterval
  currency: PriceCurrency
}

export type ResolveSellablePriceResult =
  | { status: 'ok'; price: CommercialPlanPrice }
  | { status: 'not_found' }
  | { status: 'inactive' }

export function resolveSellablePrice(catalog: CommercialPlanPrice[], params: ResolveSellablePriceParams): ResolveSellablePriceResult {
  const match = catalog.find((row) => row.planSlug === params.planSlug && row.interval === params.interval && row.currency === params.currency)

  if (!match) {
    return { status: 'not_found' }
  }

  if (!match.active) {
    return { status: 'inactive' }
  }

  return { status: 'ok', price: match }
}

export interface CreateCheckoutSessionParams {
  /** Sempre resolvido pelo servidor via `resolveSellablePrice` — nunca vindo do cliente. */
  stripePriceId: string
  /** Sempre `billing_customers.stripe_customer_id` do usuário autenticado (`getOrCreateBillingCustomer`) — nunca aceito do cliente. */
  stripeCustomerId: string
  userId: string
  successUrl: string
  cancelUrl: string
}

/**
 * Idempotency-Key: um UUID aleatório GERADO A CADA CHAMADA (nunca
 * determinístico por `userId`/`planSlug`). O propósito aqui é só proteger
 * ESTA chamada específica de criar 2 Sessions caso o SDK do Stripe refaça
 * a mesma requisição de rede internamente (retry automático de conexão) —
 * nunca impedir que o mesmo usuário abra uma nova tentativa de compra
 * legítima em seguida (2 cliques, 2 abas, tentativa após cancelar). Uma
 * chave determinística por `userId` (como em `getOrCreateBillingCustomer`)
 * seria incorreta aqui: bloquearia permanentemente qualquer nova tentativa
 * de Checkout depois da primeira. Nenhuma tabela de "checkout intents" foi
 * criada — não há necessidade arquitetural comprovada nesta etapa (a
 * validação do preço já é 100% server-side, independente de qualquer ID
 * de tentativa).
 */
export async function createCheckoutSession(stripe: Stripe, params: CreateCheckoutSessionParams): Promise<Stripe.Checkout.Session> {
  const idempotencyKey = buildCreationIdempotencyKey('checkout-session', crypto.randomUUID())

  return stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: params.stripeCustomerId,
      client_reference_id: params.userId,
      metadata: { numora_user_id: params.userId },
      line_items: [{ price: params.stripePriceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
    { idempotencyKey },
  )
}
