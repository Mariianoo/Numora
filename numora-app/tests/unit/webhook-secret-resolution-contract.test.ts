/**
 * tests/unit/webhook-secret-resolution-contract.test.ts
 * Etapa "5.10P — Live Billing Guards: Tests First" — contrato para a
 * futura separação de `STRIPE_TEST_WEBHOOK_SECRET`/`STRIPE_LIVE_WEBHOOK_SECRET`
 * (5.10O, seção 7), ainda NÃO implementada. Importa de
 * `@/lib/stripe/webhook-secret-resolution` — caminho FUTURO.
 *
 * RESULTADO ESPERADO: RED (`Cannot find module`).
 *
 * Design PURO por contrato: a futura função recebe os dois valores de
 * secret já lidos (nunca lê `process.env` sozinha) — mesma razão de design
 * dos outros contratos desta etapa, elimina qualquer necessidade de mock
 * de ambiente global. `lib/env.stripe.server.ts` NÃO foi alterado.
 *
 * Requisito central (5.10O): NUNCA um fallback silencioso entre modos —
 * testado explicitamente abaixo (mode='live' sem liveSecret nunca deve
 * "cair" para testSecret, mesmo que este esteja presente).
 */
import { describe, expect, it } from 'vitest'

// @ts-expect-error — módulo futuro (Etapa 5.10Q), ainda não implementado de propósito.
import { resolveExpectedWebhookSecret } from '@/lib/stripe/webhook-secret-resolution'

const SYNTHETIC_TEST_SECRET = `whsec_test_${'a'.repeat(24)}`
const SYNTHETIC_LIVE_SECRET = `whsec_live_${'a'.repeat(24)}`

describe('resolveExpectedWebhookSecret — contrato 5.10O/5.10P (RED esperado nesta etapa)', () => {
  it('modo test + testSecret presente → devolve o testSecret', () => {
    expect(resolveExpectedWebhookSecret({ mode: 'test', testSecret: SYNTHETIC_TEST_SECRET, liveSecret: undefined })).toBe(SYNTHETIC_TEST_SECRET)
  })

  it('modo live + liveSecret presente → devolve o liveSecret', () => {
    expect(resolveExpectedWebhookSecret({ mode: 'live', testSecret: undefined, liveSecret: SYNTHETIC_LIVE_SECRET })).toBe(SYNTHETIC_LIVE_SECRET)
  })

  it('modo test + testSecret AUSENTE → bloqueado (nunca usa o liveSecret como fallback, mesmo presente)', () => {
    expect(() => resolveExpectedWebhookSecret({ mode: 'test', testSecret: undefined, liveSecret: SYNTHETIC_LIVE_SECRET })).toThrow()
  })

  it('modo live + liveSecret AUSENTE → bloqueado (nunca usa o testSecret como fallback, mesmo presente)', () => {
    expect(() => resolveExpectedWebhookSecret({ mode: 'live', testSecret: SYNTHETIC_TEST_SECRET, liveSecret: undefined })).toThrow()
  })

  it('modo test + ambos os secrets ausentes → bloqueado', () => {
    expect(() => resolveExpectedWebhookSecret({ mode: 'test', testSecret: undefined, liveSecret: undefined })).toThrow()
  })

  it('modo live + ambos os secrets ausentes → bloqueado', () => {
    expect(() => resolveExpectedWebhookSecret({ mode: 'live', testSecret: undefined, liveSecret: undefined })).toThrow()
  })

  it('nunca devolve o secret do modo errado, mesmo quando ambos estão presentes', () => {
    const resolved = resolveExpectedWebhookSecret({ mode: 'test', testSecret: SYNTHETIC_TEST_SECRET, liveSecret: SYNTHETIC_LIVE_SECRET })
    expect(resolved).toBe(SYNTHETIC_TEST_SECRET)
    expect(resolved).not.toBe(SYNTHETIC_LIVE_SECRET)
  })
})
