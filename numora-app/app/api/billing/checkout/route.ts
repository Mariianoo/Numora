/**
 * app/api/billing/checkout/route.ts
 * Etapa "Stripe 5.3 — Checkout Foundation" — cria uma Stripe Checkout
 * Session (TEST MODE) para o usuário autenticado. NÃO cria/sincroniza
 * subscription local — isso é responsabilidade futura dos webhooks
 * (`mode: 'subscription'` só define o TIPO de Session; a subscription real
 * só nasce no Stripe depois que o cliente completa o pagamento na página
 * hospedada do Stripe, fora deste Route Handler).
 *
 * CONTRATO DO REQUEST — regra crítica de segurança (Stripe 5.3 FASE 3): o
 * cliente só envia parâmetros de NEGÓCIO (`planSlug`/`interval`/`currency`).
 * `stripe_price_id`/`stripe_customer_id` nunca são aceitos do body — o
 * servidor sempre resolve os dois (preço via `resolveSellablePrice` contra
 * o catálogo local, Customer via `getOrCreateBillingCustomer`, Stripe 5.2).
 *
 * `assertDevProject` roda antes de qualquer chamada privilegiada — mesmo
 * guard já usado em `app/api/billing/customer/route.ts`: esta fundação
 * ainda não foi aprovada para Production.
 *
 * URLs de sucesso/cancelamento: não existe hoje nenhuma variável de
 * ambiente (`NEXT_PUBLIC_SITE_URL`/`VERCEL_URL`) nem função centralizada de
 * base URL no projeto (auditado nesta etapa — todo uso existente de URL de
 * origem é `window.location.origin`, só client-side, inutilizável aqui).
 * Preferimos `NEXT_PUBLIC_SITE_URL` SE um dia for configurada; até lá,
 * derivamos a origem do próprio `Request` recebido — nunca de um header
 * client-controlável isolado, nunca de um valor arbitrário do body (zero
 * risco de open redirect: sempre aponta para o mesmo host que serviu esta
 * requisição). Sem página de billing dedicada ainda (gap documentado no
 * relatório da etapa) — success/cancel apontam para `/dashboard` (rota já
 * existente), com `?checkout=success|cancel` para uma página futura poder
 * reagir a isso.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertBillingEnvironment, gatherBillingEnvironmentContext } from '@/lib/billing/assert-billing-environment'
import { PLAN_UNAVAILABLE_MESSAGE, isPlanPurchasable } from '@/lib/billing/plan-availability'
import { clientEnv } from '@/lib/env.server'
import { getStripeClient } from '@/lib/stripe/client'
import { getCommercialPlanPricesCatalog } from '@/lib/stripe/catalog'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { checkoutRequestSchema, createCheckoutSession, resolveAnalyticsConsentSnapshot, resolveSellablePrice } from '@/lib/stripe/checkout'

function resolveAppOrigin(request: Request): string {
  if (clientEnv.NEXT_PUBLIC_SITE_URL) {
    return clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  return new URL(request.url).origin
}

export async function POST(request: Request) {
  try {
    assertBillingEnvironment(gatherBillingEnvironmentContext())
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Operação indisponível neste ambiente.' }, { status: 500 })
  }

  const sessionClient = await getSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await sessionClient.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido — esperado JSON.' }, { status: 400 })
  }

  const parsed = checkoutRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload inválido.', issues: parsed.error.issues.map((issue) => issue.message) }, { status: 400 })
  }

  const { planSlug, interval, currency } = parsed.data

  // Etapa "5.9G — First-Party Analytics Outbox" — o ÚNICO campo de
  // analytics que o cliente pode informar (nunca metadata arbitrário, ver
  // lib/stripe/analytics-outbox.ts). Ver resolveAnalyticsConsentSnapshot
  // para a regra fail-closed completa.
  const rawAnalyticsConsent = (rawBody as Record<string, unknown> | null)?.analyticsConsent
  const analyticsConsentSnapshot = resolveAnalyticsConsentSnapshot(rawAnalyticsConsent)

  if (planSlug === 'free') {
    return NextResponse.json({ error: 'O plano Free não possui Checkout — não há Stripe Product/Price associado.' }, { status: 400 })
  }

  // Bloco A (Official Launch Foundation) — barreira de DISPONIBILIDADE do
  // plano, independente do catálogo: Premium não é vendável (D1/D2) mesmo se
  // existir um `plan_prices.active=true` para ele. Roda antes de qualquer
  // acesso a Stripe/catálogo/Customer, com resposta neutra e determinística.
  if (!isPlanPurchasable(planSlug)) {
    return NextResponse.json({ error: PLAN_UNAVAILABLE_MESSAGE }, { status: 400 })
  }

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Configuração do Stripe indisponível.' }, { status: 500 })
  }

  // Leitura do catálogo comercial usa o client de SESSÃO (respeitando RLS)
  // — plan_prices já é publicamente legível por qualquer usuário
  // autenticado (mesmo nível de privilégio do que o browser já tem hoje),
  // então não há motivo para usar service_role aqui.
  let catalog
  try {
    catalog = await getCommercialPlanPricesCatalog(sessionClient)
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Falha ao ler o catálogo comercial.' }, { status: 500 })
  }

  const resolution = resolveSellablePrice(catalog, { planSlug, interval, currency })

  if (resolution.status === 'not_found') {
    return NextResponse.json({ error: `Nenhum preço vendável encontrado para ${planSlug}/${interval}/${currency}.` }, { status: 400 })
  }

  if (resolution.status === 'inactive') {
    return NextResponse.json({ error: `O preço para ${planSlug}/${interval}/${currency} não está ativo para venda.` }, { status: 400 })
  }

  const stripePriceId = resolution.price.stripePriceId
  if (!stripePriceId) {
    // Defesa em profundidade — `active=true` já garante isso via
    // `parseCommercialPlanPriceRow` (Stripe 4.1A); nunca deveria disparar.
    Sentry.captureException(new Error(`[checkout] plan_price ${resolution.price.planPriceId} está active mas sem stripePriceId`))
    return NextResponse.json({ error: 'Configuração de preço inconsistente.' }, { status: 500 })
  }

  const adminClient = getSupabaseAdminClient()

  let billingCustomer
  try {
    billingCustomer = await getOrCreateBillingCustomer(adminClient, stripe, { userId: user.id, email: user.email ?? null })
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Falha ao obter o Customer de cobrança.' }, { status: 500 })
  }

  const origin = resolveAppOrigin(request)

  // Etapa 5.9G — gerado aqui (nunca no cliente): não deriva de
  // user_id/nenhum ID do Stripe, uma nova tentativa de Checkout sempre
  // ganha um funnel_id novo (mesmo espírito da idempotency key abaixo —
  // nunca reutilizado entre tentativas).
  const funnelId = crypto.randomUUID()

  try {
    const session = await createCheckoutSession(stripe, {
      stripePriceId,
      stripeCustomerId: billingCustomer.stripeCustomerId,
      userId: user.id,
      successUrl: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/dashboard?checkout=cancel`,
      funnelId,
      analyticsConsentSnapshot,
      planSlug,
      interval,
      currency,
    })

    if (!session.url) {
      throw new Error('Stripe Checkout Session criada sem url.')
    }

    // `sessionId` preservado por compatibilidade interna (nunca foi usado
    // pelo client) — o client analytics (UpgradeToProDialog) usa
    // exclusivamente `funnelId`; o Stripe Checkout Session ID nunca deve
    // ser lido para fins de analytics no lado do cliente.
    return NextResponse.json({ url: session.url, sessionId: session.id, funnelId })
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Falha ao criar a sessão de Checkout.' }, { status: 500 })
  }
}
