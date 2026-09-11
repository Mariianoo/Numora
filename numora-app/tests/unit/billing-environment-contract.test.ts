/**
 * tests/unit/billing-environment-contract.test.ts
 * Etapa "5.10P — Live Billing Guards: Tests First" — contrato TDD para o
 * futuro `assertBillingEnvironment(...)` (desenhado na auditoria 5.10O),
 * ainda NÃO implementado. Importa de `@/lib/billing/assert-billing-environment`
 * — caminho FUTURO, que não existe nesta etapa de propósito.
 *
 * RESULTADO ESPERADO desta etapa: este arquivo FALHA ao rodar
 * (`Cannot find module '@/lib/billing/assert-billing-environment'`) — é o
 * estado RED correto de um teste contract-first contra uma função que
 * ainda não foi escrita. Não é um bug deste arquivo; é o objetivo dele.
 * Ver "5.10P — TEST-FIRST VERDICT" para a distinção entre RED esperado e
 * falha inesperada.
 *
 * Design da função (herdado do 5.10O, nunca inventado aqui): PURA — recebe
 * todos os 4 sinais já resolvidos como parâmetros, nunca lê `process.env`
 * sozinha. Isso elimina qualquer necessidade de `vi.stubEnv`/mock global
 * nestes testes — cada caso é 100% determinístico e isolado por
 * construção (nenhum estado global para vazar entre casos).
 *
 * `billingLiveEnabledFlag` é o valor CRU (string, como viria de uma env
 * var) — nunca um boolean pré-parseado — para poder distinguir "flag
 * ausente" de "flag com valor inválido" de "flag === 'true'", mesmo
 * padrão de comparação estrita já usado em `MAINTENANCE_MODE === 'true'`
 * (proxy.ts, Etapa 5.10L-A) — nunca um parse "truthy" frouxo.
 */
import { describe, expect, it } from 'vitest'

import { DEV_PROJECT_REF, PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-ref'
// @ts-expect-error — módulo futuro (Etapa 5.10Q), ainda não implementado de propósito.
import { assertBillingEnvironment } from '@/lib/billing/assert-billing-environment'

const UNKNOWN_REF = 'some-unknown-ref-38xk291'

interface Context {
  vercelEnv: string | undefined
  supabaseProjectRef: string | null
  stripeKeyMode: 'test' | 'live' | 'invalid'
  billingLiveEnabledFlag: string | undefined
}

function ctx(overrides: Partial<Context>): Context {
  return {
    vercelEnv: undefined,
    supabaseProjectRef: DEV_PROJECT_REF,
    stripeKeyMode: 'test',
    billingLiveEnabledFlag: undefined,
    ...overrides,
  }
}

describe('assertBillingEnvironment — contrato 5.10O/5.10P (RED esperado nesta etapa)', () => {
  it('1) Development (vercelEnv ausente) + DEV project + test → permitido', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: undefined, supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'test' }))).not.toThrow()
  })

  it('2) Development + DEV project + live → bloqueado', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: undefined, supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'live' }))).toThrow()
  })

  it('3) Preview + DEV project + test → permitido', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: 'preview', supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'test' }))).not.toThrow()
  })

  it('4) Preview + DEV project + live → bloqueado', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: 'preview', supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'live' }))).toThrow()
  })

  it('5a) Preview + Production project + test → bloqueado', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: 'preview', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'test' }))).toThrow()
  })

  it('5b) Preview + Production project + live → bloqueado (qualquer Stripe mode, per especificação)', () => {
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'preview', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: 'true' })),
    ).toThrow()
  })

  it('6) Production + DEV project + test → bloqueado', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'test' }))).toThrow()
  })

  it('7) Production + Production project + test → bloqueado (nunca misturar TEST com dados reais)', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'test' }))).toThrow()
  })

  it('8) Production + Production project + live + LIVE disabled → bloqueado', () => {
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: 'false' })),
    ).toThrow()
  })

  it('9) Production + Production project + live + LIVE enabled → permitido', () => {
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: 'true' })),
    ).not.toThrow()
  })

  it('10) Ref de projeto desconhecido → bloqueado, mesmo com todo o resto correto', () => {
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: UNKNOWN_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: 'true' })),
    ).toThrow()
  })

  it('10b) Ref de projeto null (indeterminável) → bloqueado', () => {
    expect(() => assertBillingEnvironment(ctx({ supabaseProjectRef: null }))).toThrow()
  })

  it('11) Stripe key mode "invalid" (ausente/formato irreconhecível) → bloqueado em qualquer ambiente', () => {
    expect(() => assertBillingEnvironment(ctx({ vercelEnv: undefined, supabaseProjectRef: DEV_PROJECT_REF, stripeKeyMode: 'invalid' }))).toThrow()
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'invalid', billingLiveEnabledFlag: 'true' })),
    ).toThrow()
  })

  it('12) Production + Production + live + flag ausente (undefined) → bloqueado', () => {
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: undefined })),
    ).toThrow()
  })

  it('13) Production + Production + live + flag inválida (valor que não é exatamente "true") → bloqueado', () => {
    for (const invalidFlag of ['1', 'yes', 'TRUE', 'enabled', '']) {
      expect(() =>
        assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: invalidFlag })),
      ).toThrow()
    }
  })

  it('14) Production + Production + live + flag === "true" → único cenário Production permitido', () => {
    expect(() =>
      assertBillingEnvironment(ctx({ vercelEnv: 'production', supabaseProjectRef: PRODUCTION_PROJECT_REF, stripeKeyMode: 'live', billingLiveEnabledFlag: 'true' })),
    ).not.toThrow()
  })
})
