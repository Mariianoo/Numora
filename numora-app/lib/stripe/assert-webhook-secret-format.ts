/**
 * lib/stripe/assert-webhook-secret-format.ts
 * Etapa "Stripe 5.4A — Webhook Foundation" — mesmo padrão de
 * `assert-test-mode.ts`: valida a FORMA de `STRIPE_WEBHOOK_SECRET`
 * (`whsec_...`) sem nunca revelar o valor em nenhuma mensagem de erro —
 * só "ausente" ou "formato inválido" são seguros de mencionar.
 */
const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]{16,}$/

export function assertStripeWebhookSecretFormat(secret: string | undefined): asserts secret is string {
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      '[assertStripeWebhookSecretFormat] STRIPE_WEBHOOK_SECRET está ausente — configure o segredo do endpoint de webhook (Stripe Dashboard → Developers → Webhooks, ou Stripe CLI em desenvolvimento) antes de usar esta rota.',
    )
  }

  if (!STRIPE_WEBHOOK_SECRET_PATTERN.test(secret)) {
    throw new Error('[assertStripeWebhookSecretFormat] STRIPE_WEBHOOK_SECRET não tem o formato esperado (whsec_...).')
  }
}
