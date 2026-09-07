/**
 * lib/stripe/sync.ts
 * Etapa "Stripe 4.1A" — preparação da futura escrita local que liga um
 * `plan_prices` a um Stripe Price real (Stripe 4.1B). NENHUMA das duas
 * funções abaixo é chamada nesta etapa — só existem prontas, testadas com
 * mock (nunca contra DEV real), para a execução futura.
 *
 * Ordem estritamente sequencial, nunca combinada num único UPDATE:
 *   1. `recordStripePriceSync` — grava `stripe_price_id`, `active`
 *      continua `false`.
 *   2. `activateSyncedPrice` — só então marca `active=true`.
 * O CHECK `chk_plan_prices_active_requires_stripe_price` (Stripe 3.2) já
 * impede o banco de aceitar `active=true` sem `stripe_price_id` mesmo se
 * essa ordem for violada por engano — estas funções respeitam a ordem por
 * clareza de fluxo, o banco garante a invariante de qualquer forma
 * (defesa em profundidade, nunca uma dependência única de correção).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function recordStripePriceSync(supabase: SupabaseClient, planPriceId: string, stripePriceId: string): Promise<void> {
  const { error } = await supabase.from('plan_prices').update({ stripe_price_id: stripePriceId }).eq('id', planPriceId)

  if (error) {
    throw new Error(`[recordStripePriceSync] Falha ao gravar stripe_price_id em plan_prices ${planPriceId}: ${error.message}`)
  }
}

export async function activateSyncedPrice(supabase: SupabaseClient, planPriceId: string): Promise<void> {
  const { error } = await supabase.from('plan_prices').update({ active: true }).eq('id', planPriceId)

  if (error) {
    throw new Error(`[activateSyncedPrice] Falha ao ativar plan_prices ${planPriceId}: ${error.message}`)
  }
}
