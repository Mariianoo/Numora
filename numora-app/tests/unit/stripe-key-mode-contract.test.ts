/**
 * tests/unit/stripe-key-mode-contract.test.ts
 * Etapa "5.10P — Live Billing Guards: Tests First" — contrato para a
 * futura `resolveStripeKeyMode(secretKey)` (generalização de
 * `assertStripeTestMode`, 5.10O seção 6), ainda NÃO implementada.
 * Importa de `@/lib/stripe/key-mode` — caminho FUTURO.
 *
 * RESULTADO ESPERADO: RED (`Cannot find module`) — ver o cabeçalho de
 * `billing-environment-contract.test.ts` para a explicação completa desse
 * padrão nesta etapa.
 *
 * Nenhum regex é duplicado aqui: os literais de teste abaixo são só
 * strings sintéticas de exemplo (nunca chaves reais), não uma reimplementação
 * do padrão de validação — esse padrão pertence exclusivamente à futura
 * função, que deve reaproveitar (ou generalizar) o mesmo regex já usado em
 * `lib/stripe/assert-test-mode.ts` (`^sk_test_[A-Za-z0-9]{16,}$`), nunca
 * duas cópias divergentes da mesma regra.
 */
import { describe, expect, it } from 'vitest'

// @ts-expect-error — módulo futuro (Etapa 5.10Q), ainda não implementado de propósito.
import { resolveStripeKeyMode } from '@/lib/stripe/key-mode'

const SYNTHETIC_TEST_KEY = `sk_test_${'a'.repeat(24)}`
const SYNTHETIC_LIVE_KEY = `sk_live_${'a'.repeat(24)}`

describe('resolveStripeKeyMode — contrato 5.10O/5.10P (RED esperado nesta etapa)', () => {
  it('chave sk_test_ válida → "test"', () => {
    expect(resolveStripeKeyMode(SYNTHETIC_TEST_KEY)).toBe('test')
  })

  it('chave sk_live_ válida → "live"', () => {
    expect(resolveStripeKeyMode(SYNTHETIC_LIVE_KEY)).toBe('live')
  })

  it('chave ausente (undefined) → "invalid"', () => {
    expect(resolveStripeKeyMode(undefined)).toBe('invalid')
  })

  it('chave vazia → "invalid"', () => {
    expect(resolveStripeKeyMode('')).toBe('invalid')
  })

  it('formato irreconhecível (nem sk_test_ nem sk_live_) → "invalid"', () => {
    expect(resolveStripeKeyMode('garbage-not-a-stripe-key')).toBe('invalid')
  })

  it('prefixo correto mas corpo curto demais (formato inválido) → "invalid", nunca "test"/"live" por engano', () => {
    expect(resolveStripeKeyMode('sk_test_short')).toBe('invalid')
    expect(resolveStripeKeyMode('sk_live_short')).toBe('invalid')
  })
})
