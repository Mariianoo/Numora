/**
 * tests/unit/webhook-livemode-contract.test.ts
 * Etapa "5.10P — Live Billing Guards: Tests First" — contrato para a
 * validação de `event.livemode` (5.10O, seções 8/9 — gap confirmado: até
 * então nenhum código lia esse campo), escrito ANTES da função existir.
 * Implementada na Etapa "5.10Q-A" em `lib/stripe/webhook-mode.ts`,
 * satisfazendo este contrato sem nenhuma alteração de asserção aqui.
 *
 * NÃO chama `verifyStripeWebhookEvent` nem qualquer coisa do SDK real do
 * Stripe — só exercita a função pura de comparação de modo, com um objeto
 * sintético mínimo (`{ livemode: ... }`), nunca um Stripe.Event real.
 */
import { describe, expect, it } from 'vitest'

import { assertWebhookLivemodeMatchesExpectedMode } from '@/lib/stripe/webhook-mode'

function syntheticEvent(livemode: unknown): { livemode: unknown } {
  return { livemode }
}

describe('assertWebhookLivemodeMatchesExpectedMode — contrato 5.10O/5.10P (RED esperado nesta etapa)', () => {
  describe('modo esperado: test', () => {
    it('event.livemode === false → permitido', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(false), 'test')).not.toThrow()
    })

    it('event.livemode === true → bloqueado (evento LIVE não pode ser aceito em modo TEST)', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(true), 'test')).toThrow()
    })
  })

  describe('modo esperado: live', () => {
    it('event.livemode === true → permitido', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(true), 'live')).not.toThrow()
    })

    it('event.livemode === false → bloqueado (evento TEST não pode ser aceito em modo LIVE)', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(false), 'live')).toThrow()
    })
  })

  describe('entradas inválidas — sempre bloqueado, independente do modo esperado', () => {
    it('campo livemode ausente (undefined) → bloqueado', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(undefined), 'test')).toThrow()
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(undefined), 'live')).toThrow()
    })

    it('tipo inválido (string em vez de boolean) → bloqueado', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent('true'), 'test')).toThrow()
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent('false'), 'live')).toThrow()
    })

    it('tipo inválido (número) → bloqueado', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(1), 'live')).toThrow()
    })

    it('tipo inválido (null) → bloqueado', () => {
      expect(() => assertWebhookLivemodeMatchesExpectedMode(syntheticEvent(null), 'test')).toThrow()
    })
  })
})
