/**
 * lib/stripe/key-mode.ts
 * Etapa "5.10Q-A — Live Billing Guards" — generalização de
 * `assertStripeTestMode` (que só sabia "bloquear LIVE sempre"): esta
 * função PURA só CLASSIFICA a chave, nunca decide se o modo é permitido
 * no ambiente atual — essa decisão pertence exclusivamente a
 * `assertBillingEnvironment` (`lib/billing/assert-billing-environment.ts`),
 * nunca duplicada aqui.
 *
 * Reaproveita `STRIPE_TEST_KEY_PATTERN` de `lib/stripe/assert-test-mode.ts`
 * — nunca uma segunda cópia do mesmo regex. `STRIPE_LIVE_KEY_PATTERN` é
 * novo (o arquivo antigo nunca precisou validar o FORMATO de uma chave
 * LIVE, só recusava pelo prefixo).
 *
 * Nunca loga a chave — só devolve um rótulo (`'test'|'live'|'invalid'`).
 */
import { STRIPE_TEST_KEY_PATTERN } from './assert-test-mode'

export type StripeKeyMode = 'test' | 'live' | 'invalid'

const STRIPE_LIVE_KEY_PATTERN = /^sk_live_[A-Za-z0-9]{16,}$/

export function resolveStripeKeyMode(secretKey: string | undefined): StripeKeyMode {
  if (!secretKey || secretKey.trim().length === 0) {
    return 'invalid'
  }
  if (STRIPE_TEST_KEY_PATTERN.test(secretKey)) {
    return 'test'
  }
  if (STRIPE_LIVE_KEY_PATTERN.test(secretKey)) {
    return 'live'
  }
  return 'invalid'
}
