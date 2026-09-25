/**
 * lib/stripe/subscription-management.ts
 * Etapa "Stripe 5.6 — Customer Portal / Gestão da Assinatura" —
 * cancelamento, upgrade (Pro→Premium, imediato) e downgrade
 * (Premium→Pro, agendado via Stripe Subscription Schedule) da subscription
 * do usuário autenticado.
 *
 * OWNERSHIP (FASE 11 de todas as etapas Stripe anteriores, preservada
 * aqui): toda função recebe `userId` (da sessão real, nunca do body) e
 * resolve a subscription ELEGÍVEL (`trialing`/`active`/`past_due` — Stripe
 * 5.1) desse usuário diretamente no banco — nunca aceita
 * `subscriptionId`/`customerId`/`priceId` de fora. Sem subscription
 * elegível → falha explícita, nunca escolhe outra arbitrariamente (a
 * UNIQUE da Stripe 5.1 já garante no máximo 1 linha elegível por usuário).
 *
 * MOEDA (FASE 7): imutável por subscription — trocar BRL↔USD nunca passa
 * por aqui; é sempre cancelamento + novo Checkout na moeda desejada.
 *
 * IDEMPOTÊNCIA (FASE 12): nunca inventa um mecanismo próprio — usa o
 * próprio estado do Stripe como autoridade. `cancel_at_period_end: true`
 * chamado 2x seguidas no Stripe é idempotente por natureza (mesmo
 * resultado). Downgrade: antes de criar um Schedule novo, sempre verifica
 * `subscription.schedule` (o Stripe já diz se um existe) e REUTILIZA/
 * ATUALIZA esse mesmo Schedule em vez de criar um segundo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { PLAN_UNAVAILABLE_MESSAGE, isPlanPurchasable } from '@/lib/billing/plan-availability'
import { getCommercialPlanPricesCatalog, type PaidPlanSlug, type PriceCurrency, type PriceInterval } from './catalog'
import { resolveSellablePrice } from './checkout'
import { syncSubscriptionFromStripe } from './subscription-sync'

const ELIGIBLE_STATUSES = ['trialing', 'active', 'past_due']

/** Estados que o Stripe já trata como terminais — nenhuma cobrança futura é possível, nenhuma ação de cancelamento é necessária (ou sequer aceita pela API do Stripe). */
const STRIPE_TERMINAL_STATUSES: Stripe.Subscription.Status[] = ['canceled', 'incomplete_expired']

export interface OwnedSubscription {
  id: string
  stripeSubscriptionId: string
  planSlug: PaidPlanSlug
  stripePriceId: string
}

interface OwnedSubscriptionRow {
  id: string
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  plans: { slug: string } | { slug: string }[] | null
}

function resolvePlanSlug(plans: OwnedSubscriptionRow['plans']): string | null {
  if (!plans) return null
  return Array.isArray(plans) ? (plans[0]?.slug ?? null) : plans.slug
}

/**
 * Resolve a ÚNICA subscription elegível do usuário — nunca aceita esse ID
 * de fora. Falha explícita se não houver nenhuma, ou se ela não pertencer
 * a um plano pago conhecido (estado que nunca deveria ocorrer, mas nunca
 * mascarado se ocorrer).
 */
export async function resolveOwnedEligibleSubscription(supabase: SupabaseClient, userId: string): Promise<OwnedSubscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, stripe_subscription_id, stripe_price_id, plans:plan_id(slug)')
    .eq('user_id', userId)
    .in('status', ELIGIBLE_STATUSES)
    .maybeSingle()

  if (error) {
    throw new Error(`[subscription-management] Falha ao consultar a subscription do usuário: ${error.message}`)
  }
  const row = data as OwnedSubscriptionRow | null
  if (!row || !row.stripe_subscription_id || !row.stripe_price_id) {
    throw new Error('[subscription-management] Nenhuma subscription elegível encontrada para este usuário.')
  }

  const slug = resolvePlanSlug(row.plans)
  if (slug !== 'pro' && slug !== 'premium') {
    throw new Error(`[subscription-management] A subscription ${row.id} não pertence a um plano pago conhecido (slug: ${slug ?? 'null'}).`)
  }

  return { id: row.id, stripeSubscriptionId: row.stripe_subscription_id, planSlug: slug, stripePriceId: row.stripe_price_id }
}

/** FASE 2 (cancelamento): `cancel_at_period_end: true`, NUNCA `stripe.subscriptions.cancel()` (que cancelaria imediatamente). */
export async function cancelOwnSubscription(supabase: SupabaseClient, stripe: Stripe, userId: string): Promise<Stripe.Subscription> {
  const owned = await resolveOwnedEligibleSubscription(supabase, userId)
  return stripe.subscriptions.update(owned.stripeSubscriptionId, { cancel_at_period_end: true })
}

export interface ChangePlanTarget {
  planSlug: PaidPlanSlug
  interval: PriceInterval
  currency: PriceCurrency
}

export type ChangePlanResult =
  | { kind: 'upgraded'; stripeSubscriptionId: string }
  | { kind: 'downgrade_scheduled'; stripeSubscriptionId: string; stripeScheduleId: string }

/**
 * FASE 5/6: resolve o Price alvo exclusivamente pelo catálogo local
 * (nunca por parâmetro do cliente), confirma que a moeda não muda, e
 * decide entre upgrade imediato (Pro→Premium) ou downgrade agendado
 * (Premium→Pro) — a única direção suportada nesta etapa é exatamente
 * essa dupla combinação; qualquer outra transição falha explicitamente.
 */
export async function changeOwnPlan(supabase: SupabaseClient, stripe: Stripe, userId: string, target: ChangePlanTarget): Promise<ChangePlanResult> {
  // Bloco A (Official Launch Foundation) — barreira de disponibilidade do
  // plano de DESTINO, antes de qualquer leitura de banco ou chamada ao
  // Stripe: Premium não é contratável (nem via upgrade Pro→Premium),
  // independente de `plan_prices.active`. O destino Pro (downgrade
  // Premium→Pro) continua permitido.
  if (!isPlanPurchasable(target.planSlug)) {
    throw new Error(`[subscription-management] ${PLAN_UNAVAILABLE_MESSAGE}`)
  }

  const owned = await resolveOwnedEligibleSubscription(supabase, userId)

  if (owned.planSlug === target.planSlug) {
    throw new Error(`[subscription-management] A subscription já está no plano ${target.planSlug} — troca de interval/moeda dentro do mesmo plano não é suportada nesta etapa.`)
  }

  const catalog = await getCommercialPlanPricesCatalog(supabase)

  const currentPrice = catalog.find((row) => row.stripePriceId === owned.stripePriceId)
  if (!currentPrice) {
    throw new Error(`[subscription-management] O preço atual da subscription (${owned.stripePriceId}) não foi encontrado no catálogo comercial local.`)
  }
  // FASE 7 — moeda é imutável por subscription: nunca faz parte desta troca.
  if (currentPrice.currency !== target.currency) {
    throw new Error(
      `[subscription-management] Mudança de moeda não é suportada (subscription atual em ${currentPrice.currency}, solicitado ${target.currency}). Cancele a assinatura atual e inicie um novo Checkout na moeda desejada.`,
    )
  }

  const resolution = resolveSellablePrice(catalog, target)
  if (resolution.status !== 'ok') {
    throw new Error(`[subscription-management] Preço indisponível para ${target.planSlug}/${target.interval}/${target.currency} (${resolution.status}).`)
  }
  const targetStripePriceId = resolution.price.stripePriceId
  if (!targetStripePriceId) {
    throw new Error(`[subscription-management] plan_price ${resolution.price.planPriceId} está ativo mas sem stripePriceId — configuração inconsistente.`)
  }

  if (owned.planSlug === 'pro' && target.planSlug === 'premium') {
    await upgradeImmediately(stripe, owned.stripeSubscriptionId, targetStripePriceId)
    return { kind: 'upgraded', stripeSubscriptionId: owned.stripeSubscriptionId }
  }

  if (owned.planSlug === 'premium' && target.planSlug === 'pro') {
    const scheduleId = await scheduleDowngrade(stripe, owned.stripeSubscriptionId, targetStripePriceId)
    return { kind: 'downgrade_scheduled', stripeSubscriptionId: owned.stripeSubscriptionId, stripeScheduleId: scheduleId }
  }

  throw new Error(`[subscription-management] Transição de plano não suportada nesta etapa: ${owned.planSlug} → ${target.planSlug}.`)
}

async function upgradeImmediately(stripe: Stripe, stripeSubscriptionId: string, targetStripePriceId: string): Promise<Stripe.Subscription> {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  if (subscription.items.data.length !== 1) {
    throw new Error(`[subscription-management] subscription ${stripeSubscriptionId} tem ${subscription.items.data.length} item(ns) — esperado exatamente 1 para resolver o upgrade sem ambiguidade.`)
  }
  const itemId = subscription.items.data[0].id

  return stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: itemId, price: targetStripePriceId }],
    proration_behavior: 'always_invoice',
  })
}

/**
 * FASE 6: nunca cria um segundo Schedule para a mesma subscription —
 * `subscription.schedule` é a própria autoridade do Stripe sobre "já existe
 * um agendamento?". Se existir, REUTILIZA (via `subscriptionSchedules.update`,
 * substituindo a fase final) — idempotente: chamar de novo com o mesmo
 * `targetStripePriceId` produz o mesmo resultado final.
 */
async function scheduleDowngrade(stripe: Stripe, stripeSubscriptionId: string, targetStripePriceId: string): Promise<string> {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  const existingScheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : (subscription.schedule?.id ?? null)

  const scheduleId = existingScheduleId ?? (await stripe.subscriptionSchedules.create({ from_subscription: stripeSubscriptionId })).id
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)

  const currentPhase = schedule.phases[0]
  if (!currentPhase) {
    throw new Error(`[subscription-management] Subscription Schedule ${scheduleId} não tem nenhuma fase — estado inesperado.`)
  }

  const currentPhaseItems = currentPhase.items.map((phaseItem) => ({
    price: typeof phaseItem.price === 'string' ? phaseItem.price : phaseItem.price.id,
    quantity: phaseItem.quantity ?? 1,
  }))

  const updated = await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: 'release',
    phases: [
      { items: currentPhaseItems, start_date: currentPhase.start_date, end_date: currentPhase.end_date },
      { items: [{ price: targetStripePriceId, quantity: 1 }] },
    ],
  })

  return updated.id
}

export interface CancelAccountSubscriptionsResult {
  /** `null` quando o usuário nunca teve nenhum billing_customer (Free/courtesy-only) — nenhuma chamada ao Stripe foi feita. */
  stripeCustomerId: string | null
  canceledSubscriptionIds: string[]
}

/**
 * Etapa "5.7 — Account Deletion x Stripe" — cancela TODA subscription
 * Stripe ainda não terminal (`STRIPE_TERMINAL_STATUSES`) do Customer
 * vinculado a este usuário, ANTES de qualquer exclusão local
 * (`app/api/account/delete/route.ts`). Nunca confia no `status` local de
 * `subscriptions` (pode estar desatualizado se o webhook não processou a
 * última mudança) — sempre lista o estado CANÔNICO direto do Stripe
 * (`stripe.subscriptions.list`), mesma filosofia de
 * `syncSubscriptionFromStripe`.
 *
 * Se a subscription tiver um Subscription Schedule ativo, cancela o
 * SCHEDULE (`subscriptionSchedules.cancel`) — que cancela a subscription
 * associada atomicamente do lado do Stripe — em vez de cancelar a
 * subscription diretamente: evita o Schedule tentar executar uma troca de
 * fase numa subscription que a aplicação já considera encerrada, e evita 2
 * chamadas quando 1 resolve as duas coisas.
 *
 * NUNCA usa `cancel_at_period_end` (diferente de `cancelOwnSubscription`,
 * Stripe 5.6) — a conta está sendo apagada, não há usuário para manter
 * acesso até o fim do período; cancelamento é sempre IMEDIATO.
 *
 * NUNCA deleta o Stripe Customer (`customers.del`) — preservado
 * deliberadamente para histórico/auditoria de invoices; só a capacidade de
 * gerar NOVA cobrança é removida.
 *
 * `userId` nunca vem de fora — sempre resolvido pela sessão real do
 * chamador. `getStripe` só é invocado (e só então a validação de TEST MODE
 * roda) quando existe de fato um `stripe_customer_id` a tratar — um usuário
 * Free ou courtesy-only nunca instancia o client Stripe.
 *
 * Propaga qualquer erro sem mascarar — quem decide "abortar a exclusão de
 * conta" é o chamador (fail-closed), nunca esta função.
 */
export async function cancelAllStripeSubscriptionsForAccountDeletion(
  supabase: SupabaseClient,
  getStripe: () => Stripe,
  userId: string,
): Promise<CancelAccountSubscriptionsResult> {
  const { data: billingCustomer, error } = await supabase.from('billing_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle()

  if (error) {
    throw new Error(`[subscription-management] Falha ao consultar billing_customers para user_id ${userId}: ${error.message}`)
  }

  if (!billingCustomer?.stripe_customer_id) {
    return { stripeCustomerId: null, canceledSubscriptionIds: [] }
  }

  const stripeCustomerId = billingCustomer.stripe_customer_id as string
  const stripe = getStripe()
  const canceledSubscriptionIds: string[] = []

  for await (const subscription of stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all' })) {
    if (STRIPE_TERMINAL_STATUSES.includes(subscription.status)) {
      continue
    }

    const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : (subscription.schedule?.id ?? null)

    if (scheduleId) {
      await stripe.subscriptionSchedules.cancel(scheduleId)
    } else {
      await stripe.subscriptions.cancel(subscription.id)
    }

    canceledSubscriptionIds.push(subscription.id)

    // Reflete o cancelamento localmente já aqui — se um passo posterior da
    // exclusão de conta falhar, o estado local não fica divergente (nunca
    // mostrando "active" para uma subscription que o Stripe já encerrou).
    await syncSubscriptionFromStripe(supabase, stripe, subscription.id, null)
  }

  return { stripeCustomerId, canceledSubscriptionIds }
}
