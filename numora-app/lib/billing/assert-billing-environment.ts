/**
 * lib/billing/assert-billing-environment.ts
 * Etapa "5.10Q-A — Live Billing Guards" — guard central único que
 * substitui `assertDevProject` como a barreira de billing (auditoria
 * 5.10O, aprovada). Combina 4 sinais independentes — nunca um deles
 * sozinho autoriza nada (5.10O §16: "todas as condições devem ser
 * cumulativas", nunca um `if production allow`):
 *
 *   1. `vercelEnv`        — `process.env.VERCEL_ENV` ('production'/'preview'/ausente)
 *   2. `supabaseProjectRef` — extraído de `NEXT_PUBLIC_SUPABASE_URL`
 *   3. `stripeKeyMode`    — 'test'|'live'|'invalid' (`resolveStripeKeyMode`)
 *   4. `billingLiveEnabledFlag` — valor CRU de `BILLING_LIVE_ENABLED`
 *      (string, nunca um boolean pré-parseado — só a comparação estrita
 *      `=== 'true'` habilita, mesmo padrão de `MAINTENANCE_MODE`, Etapa
 *      5.10L-A — nunca um parse "truthy" frouxo)
 *
 * PURA e determinística: `assertBillingEnvironment` nunca lê `process.env`
 * sozinha, nunca faz I/O, nunca tem side effect — só lança ou não lança.
 * `gatherBillingEnvironmentContext` é o único ponto que lê o ambiente
 * ambiente de verdade — chamadores de produção (rotas, `getStripeClient`)
 * compõem os dois: `assertBillingEnvironment(gatherBillingEnvironmentContext())`.
 *
 * ÚNICO cenário permitido com um ref de Production: Production (Vercel) +
 * ref de Production + chave LIVE + `BILLING_LIVE_ENABLED === 'true'` — as
 * quatro condições, nunca três. Todo o resto com ref de Production é
 * bloqueado, incluindo o próprio ref de Production fora do ambiente
 * Production da Vercel (nunca permitido em local/Preview, mesmo com uma
 * chave de teste). Fora de Production, só chave TEST é aceita — LIVE
 * nunca é permitida em Development nem em Preview, sem exceção.
 */
import { clientEnv } from '@/lib/env.server'
import { extractProjectRef, DEV_PROJECT_REF, PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-ref'
import { resolveStripeKeyMode, type StripeKeyMode } from '@/lib/stripe/key-mode'

export interface BillingEnvironmentContext {
  vercelEnv: string | undefined
  supabaseProjectRef: string | null
  stripeKeyMode: StripeKeyMode
  billingLiveEnabledFlag: string | undefined
}

/** Lê o ambiente real — único ponto de I/O deste módulo. Nunca lança. */
export function gatherBillingEnvironmentContext(): BillingEnvironmentContext {
  return {
    vercelEnv: process.env.VERCEL_ENV,
    supabaseProjectRef: extractProjectRef(clientEnv.NEXT_PUBLIC_SUPABASE_URL),
    stripeKeyMode: resolveStripeKeyMode(process.env.STRIPE_SECRET_KEY),
    billingLiveEnabledFlag: process.env.BILLING_LIVE_ENABLED,
  }
}

/**
 * Lança se a combinação não for uma das explicitamente permitidas —
 * fail-closed: qualquer combinação não reconhecida é bloqueada, nunca
 * "deixada passar" por omissão.
 */
export function assertBillingEnvironment(context: BillingEnvironmentContext): void {
  const { vercelEnv, supabaseProjectRef, stripeKeyMode, billingLiveEnabledFlag } = context

  if (stripeKeyMode === 'invalid') {
    throw new Error('[assertBillingEnvironment] Stripe key mode inválido ou ausente — abortando (fail-closed).')
  }

  if (supabaseProjectRef !== DEV_PROJECT_REF && supabaseProjectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error('[assertBillingEnvironment] Supabase project ref desconhecido ou indeterminável — abortando (fail-closed).')
  }

  const isProductionRef = supabaseProjectRef === PRODUCTION_PROJECT_REF
  const isProductionVercelEnv = vercelEnv === 'production'

  // O ref de Production nunca é aceito fora do ambiente Production da
  // Vercel — nem local, nem Preview — independente de qualquer outra
  // condição (5.10P cenário 5: "Preview + Production project → bloqueado,
  // independentemente da key").
  if (isProductionRef && !isProductionVercelEnv) {
    throw new Error('[assertBillingEnvironment] O projeto Supabase de Production só pode ser usado dentro do ambiente Production da Vercel — abortando (fail-closed).')
  }

  if (isProductionVercelEnv) {
    if (!isProductionRef) {
      throw new Error('[assertBillingEnvironment] Production (Vercel) precisa apontar para o projeto Supabase de Production — abortando (fail-closed).')
    }
    if (stripeKeyMode === 'test') {
      throw new Error('[assertBillingEnvironment] Production nunca pode operar com uma chave Stripe de TEST — abortando (fail-closed).')
    }
    // stripeKeyMode === 'live' a partir daqui — única condição que falta é a flag explícita.
    if (billingLiveEnabledFlag !== 'true') {
      throw new Error('[assertBillingEnvironment] Billing LIVE não está explicitamente habilitado (BILLING_LIVE_ENABLED !== "true") — abortando (fail-closed).')
    }
    return // Production + ref de Production + LIVE + flag true — único cenário permitido com ref de Production.
  }

  // Fora de Production (Development local ou Preview): LIVE nunca é permitido, sem exceção.
  if (stripeKeyMode === 'live') {
    throw new Error('[assertBillingEnvironment] Chaves Stripe LIVE nunca são permitidas fora do ambiente Production — abortando (fail-closed).')
  }
  // DEV ref + chave TEST + (Development ou Preview) — permitido.
}
