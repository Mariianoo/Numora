/**
 * app/api/billing/subscription/change-plan/route.ts
 * Etapa "Stripe 5.6" — upgrade (Pro→Premium, imediato com proration) e
 * downgrade (Premium→Pro, agendado via Stripe Subscription Schedule) da
 * subscription do usuário autenticado.
 *
 * CONTRATO DO REQUEST — mesma regra de segurança da Stripe 5.3: o cliente
 * só envia parâmetros de NEGÓCIO (`planSlug`/`interval`/`currency`).
 * `priceId`/`stripePriceId`/`customerId`/`subscriptionId` NUNCA existem no
 * schema — o servidor sempre resolve o Price pelo catálogo local
 * (`lib/stripe/subscription-management.ts`) e a subscription pelo
 * `user.id` da sessão.
 *
 * Erros de `changeOwnPlan` são todos de validação de negócio (moeda
 * imutável, plano já atual, transição não suportada, price/ownership) —
 * por isso a mensagem é repassada ao cliente (nunca inclui segredos), como
 * "erro de negócio claro" (FASE 7). Falhas de infraestrutura (Stripe/DB
 * fora do ar) continuam genéricas.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertBillingEnvironment, gatherBillingEnvironmentContext } from '@/lib/billing/assert-billing-environment'
import { PLAN_UNAVAILABLE_MESSAGE, isPlanPurchasable } from '@/lib/billing/plan-availability'
import { getStripeClient } from '@/lib/stripe/client'
import { VALID_CURRENCIES, VALID_INTERVALS } from '@/lib/stripe/catalog'
import { changeOwnPlan } from '@/lib/stripe/subscription-management'
import { syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'

const changePlanRequestSchema = z.object({
  planSlug: z.enum(['pro', 'premium']),
  interval: z.enum(VALID_INTERVALS),
  currency: z.enum(VALID_CURRENCIES),
})

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

  const parsed = changePlanRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload inválido.', issues: parsed.error.issues.map((issue) => issue.message) }, { status: 400 })
  }

  // Bloco A (Official Launch Foundation) — o plano DE DESTINO precisa estar
  // disponível para contratação: bloqueia Pro→Premium (Premium é "Em
  // breve", D1/D2) antes de qualquer acesso a Stripe/banco. Downgrade
  // Premium→Pro (destino Pro) continua permitido. `changeOwnPlan` repete
  // esta checagem (defesa em profundidade para qualquer outro chamador).
  if (!isPlanPurchasable(parsed.data.planSlug)) {
    return NextResponse.json({ error: PLAN_UNAVAILABLE_MESSAGE }, { status: 400 })
  }

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Configuração do Stripe indisponível.' }, { status: 500 })
  }

  const adminClient = getSupabaseAdminClient()

  try {
    const result = await changeOwnPlan(adminClient, stripe, user.id, parsed.data)
    await syncSubscriptionFromStripe(adminClient, stripe, result.stripeSubscriptionId, null)

    return NextResponse.json({ kind: result.kind })
  } catch (err) {
    Sentry.captureException(err)
    const message = err instanceof Error ? err.message : 'Falha ao alterar o plano.'
    // Erros de [subscription-management] são sempre validação de negócio — nunca vazam segredos.
    const isBusinessError = message.startsWith('[subscription-management]')
    return NextResponse.json({ error: isBusinessError ? message.replace('[subscription-management] ', '') : 'Falha ao alterar o plano.' }, { status: isBusinessError ? 400 : 500 })
  }
}
