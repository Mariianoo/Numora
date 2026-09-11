/**
 * lib/stripe/webhook-mode.ts
 * Etapa "5.10Q-A — Live Billing Guards" — segunda camada de proteção do
 * webhook (5.10O §8/9, gap confirmado: nenhum código lia `event.livemode`
 * antes desta etapa). NUNCA substitui a verificação de assinatura
 * (`verifyStripeWebhookEvent`, inalterada) — só roda DEPOIS dela, contra
 * um evento já comprovadamente assinado pelo Stripe.
 *
 * Pura, sem I/O — recebe o evento já verificado e o modo esperado (já
 * validado por `assertBillingEnvironment`), nunca decide sozinha qual
 * modo é permitido no ambiente atual.
 *
 * Fail-closed: campo ausente ou de tipo errado é tratado como
 * discrepância, nunca "assume que está tudo bem".
 */
export type ExpectedStripeMode = 'test' | 'live'

export interface WebhookLivemodeEvent {
  livemode?: unknown
}

export function assertWebhookLivemodeMatchesExpectedMode(event: WebhookLivemodeEvent, expectedMode: ExpectedStripeMode): void {
  if (typeof event.livemode !== 'boolean') {
    throw new Error('[assertWebhookLivemodeMatchesExpectedMode] event.livemode ausente ou com tipo inválido — abortando (fail-closed).')
  }

  const expectedLivemode = expectedMode === 'live'
  if (event.livemode !== expectedLivemode) {
    throw new Error(
      `[assertWebhookLivemodeMatchesExpectedMode] event.livemode (${event.livemode}) não corresponde ao modo esperado neste ambiente ("${expectedMode}") — abortando (fail-closed).`,
    )
  }
}
