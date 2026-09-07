/**
 * tests/unit/stripe-assert-test-mode.test.ts
 * Etapa "Stripe 4.1A" — `assertStripeTestMode` (lib/stripe/assert-test-mode.ts).
 * Nenhum teste aqui chama o Stripe — só valida o formato da string da chave.
 */
import { describe, expect, it } from 'vitest'

import { assertStripeTestMode } from '@/lib/stripe/assert-test-mode'

// GitHub Push Protection (e scanners de segredo equivalentes) sinalizam
// qualquer sequência contígua no formato `sk_test_[A-Za-z0-9]{16,}` como
// possível credencial real do Stripe, mesmo quando o valor é fictício.
// Construído aqui a partir de 2 partes nunca concatenadas no código-fonte
// (só em runtime) — nenhuma delas, isoladamente, tem o formato de uma
// chave — para nunca existir como um literal contínuo no histórico do
// Git, mas ainda produzir exatamente a string que exercita o regex real
// de `assertStripeTestMode` (`^sk_test_[A-Za-z0-9]{16,}$`).
const FAKE_TEST_KEY_PREFIX = 'sk_test_'
const FAKE_TEST_KEY_SUFFIX = 'faketestfaketestfaketest'
const FAKE_VALID_TEST_KEY = FAKE_TEST_KEY_PREFIX + FAKE_TEST_KEY_SUFFIX

describe('assertStripeTestMode', () => {
  it('rejeita chave ausente/vazia', () => {
    expect(() => assertStripeTestMode('')).toThrow(/vazia/)
  })

  it('rejeita string só com espaços', () => {
    expect(() => assertStripeTestMode('   ')).toThrow(/vazia/)
  })

  it('rejeita chave sk_live_ explicitamente', () => {
    // Sufixo com hífen de propósito (nunca ocorre numa chave real do
    // Stripe, que é só alfanumérica) — `assertStripeTestMode` só olha o
    // prefixo aqui (`startsWith('sk_live_')`), então o sufixo pode ser
    // qualquer coisa; escolhido para nunca casar com o formato que
    // scanners de segredo (ex.: GitHub Push Protection) procuram.
    expect(() => assertStripeTestMode('sk_live_not-a-real-key-placeholder')).toThrow(/LIVE/)
  })

  it('aceita chave sk_test_ com formato válido', () => {
    expect(() => assertStripeTestMode(FAKE_VALID_TEST_KEY)).not.toThrow()
  })

  it('rejeita formato claramente inválido (nem test nem live)', () => {
    expect(() => assertStripeTestMode('minha-chave-qualquer')).toThrow(/formato esperado/)
  })

  it('rejeita sk_test_ curto demais para ser uma chave real', () => {
    expect(() => assertStripeTestMode('sk_test_abc')).toThrow(/formato esperado/)
  })

  it('nunca inclui a própria chave na mensagem de erro (nunca logar secret)', () => {
    // Hífen de propósito, mesma razão do teste de rejeição acima — nunca
    // um formato que um scanner de segredo reconheceria como credencial
    // real, mas ainda distintivo o bastante para provar a asserção abaixo.
    const secret = 'sk_live_placeholder-should-not-leak-anywhere'
    try {
      assertStripeTestMode(secret)
      throw new Error('deveria ter lançado')
    } catch (error) {
      expect((error as Error).message).not.toContain(secret)
    }
  })
})
