/**
 * tests/unit/webhook-mode-matrix-contract.test.ts
 * Etapa "5.10P — Live Billing Guards: Tests First" — matriz combinada da
 * seção 8 do relatório 5.10O: environment esperado + `event.livemode` +
 * resolução de secret, compostos (nunca uma quarta implementação
 * paralela — reaproveita as mesmas 3 funções futuras já contratadas nos
 * outros arquivos desta etapa).
 *
 * RESULTADO ESPERADO: RED (`Cannot find module`) — os 3 imports abaixo
 * apontam para módulos futuros (Etapa 5.10Q).
 *
 * LIMITAÇÃO DOCUMENTADA (linha "secret TEST usado em ambiente LIVE" da
 * tabela do prompt): a defesa PRIMÁRIA contra um secret do modo errado é
 * criptográfica — `verifyStripeWebhookEvent`/`stripe.webhooks.constructEvent`
 * (nunca alterado ou testado aqui) rejeitaria a assinatura antes de
 * qualquer coisa, porque um evento TEST é assinado com o secret TEST, que
 * nunca bate com o secret LIVE. O que esta suíte pode testar de forma
 * pura é só a defesa SECUNDÁRIA (defesa em profundidade): mesmo que,
 * hipoteticamente, uma assinatura tivesse verificado com sucesso contra o
 * secret errado, a checagem independente de `event.livemode` ainda
 * bloquearia — é exatamente isso que o cenário 6 abaixo prova.
 */
import { describe, expect, it } from 'vitest'

import { DEV_PROJECT_REF, PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-ref'
// @ts-expect-error — módulo futuro (Etapa 5.10Q), ainda não implementado de propósito.
import { assertBillingEnvironment } from '@/lib/billing/assert-billing-environment'
// @ts-expect-error — módulo futuro (Etapa 5.10Q), ainda não implementado de propósito.
import { assertWebhookLivemodeMatchesExpectedMode } from '@/lib/stripe/webhook-mode'
// @ts-expect-error — módulo futuro (Etapa 5.10Q), ainda não implementado de propósito.
import { resolveExpectedWebhookSecret } from '@/lib/stripe/webhook-secret-resolution'

const SYNTHETIC_TEST_SECRET = `whsec_test_${'a'.repeat(24)}`
const SYNTHETIC_LIVE_SECRET = `whsec_live_${'a'.repeat(24)}`

/** Deriva o "modo esperado" da mesma forma que a futura rota de webhook faria: ambiente permitido → modo correspondente. */
function expectedModeFor(vercelEnv: string | undefined, supabaseProjectRef: string, billingLiveEnabledFlag?: string): 'test' | 'live' {
  return vercelEnv === 'production' && supabaseProjectRef === PRODUCTION_PROJECT_REF && billingLiveEnabledFlag === 'true' ? 'live' : 'test'
}

describe('Matriz combinada webhook (environment + livemode + secret) — contrato 5.10O §8 (RED esperado nesta etapa)', () => {
  it('1) DEV | modo esperado TEST | event.livemode=false → PASS', () => {
    expect(() => assertBillingEnvironment({ vercelEnv: undefined, supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'test', billingLiveEnabledFlag: undefined })).not.toThrow()
    expect(() => assertWebhookLivemodeMatchesExpectedMode({ livemode: false }, 'test')).not.toThrow()
  })

  it('2) DEV | modo esperado TEST | event.livemode=true → BLOCK', () => {
    expect(() => assertWebhookLivemodeMatchesExpectedMode({ livemode: true }, 'test')).toThrow()
  })

  it('3) Production LIVE | modo esperado LIVE | event.livemode=true → PASS', () => {
    const mode = expectedModeFor('production', PRODUCTION_PROJECT_REF, 'true')
    expect(mode).toBe('live')
    expect(() => assertBillingEnvironment({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: 'true' })).not.toThrow()
    expect(() => assertWebhookLivemodeMatchesExpectedMode({ livemode: true }, mode)).not.toThrow()
  })

  it('4) Production LIVE | modo esperado LIVE | event.livemode=false → BLOCK', () => {
    const mode = expectedModeFor('production', PRODUCTION_PROJECT_REF, 'true')
    expect(() => assertWebhookLivemodeMatchesExpectedMode({ livemode: false }, mode)).toThrow()
  })

  it('5) Production TEST (billing LIVE desabilitado) | modo esperado TEST | event.livemode=false → BLOCK (o ambiente em si já bloqueia, mesmo o livemode "batendo")', () => {
    // Etapa 5.10O: Production nunca deveria operar em modo TEST — o guard de
    // ambiente bloqueia isso INDEPENDENTE do livemode do evento bater ou não.
    expect(() =>
      assertBillingEnvironment({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'test', billingLiveEnabledFlag: undefined }),
    ).toThrow()
  })

  it('6) Production LIVE | secret TEST usado (defesa em profundidade via livemode, ver limitação documentada no cabeçalho) → BLOCK', () => {
    // resolveExpectedWebhookSecret para mode='live' nunca devolve o secret
    // TEST, mesmo que ambos estejam configurados (contrato já coberto em
    // webhook-secret-resolution-contract.test.ts) — reforçado aqui:
    const resolved = resolveExpectedWebhookSecret({ mode: 'live', testSecret: SYNTHETIC_TEST_SECRET, liveSecret: SYNTHETIC_LIVE_SECRET })
    expect(resolved).toBe(SYNTHETIC_LIVE_SECRET)
    expect(resolved).not.toBe(SYNTHETIC_TEST_SECRET)

    // E mesmo num cenário hipotético em que um evento TEST (livemode=false)
    // tivesse alcançado esta etapa, a checagem de livemode ainda bloqueia
    // independentemente — nunca dependemos só da verificação de assinatura.
    expect(() => assertWebhookLivemodeMatchesExpectedMode({ livemode: false }, 'live')).toThrow()
  })
})
