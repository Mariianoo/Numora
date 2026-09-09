/**
 * app/api/billing/subscription/cancel/route.ts
 * Etapa "Stripe 5.6" — cancela a subscription do usuário autenticado no
 * FINAL do período pago (`cancel_at_period_end: true`, nunca
 * `stripe.subscriptions.cancel()`). Ownership: `resolveOwnedEligibleSubscription`
 * (lib/stripe/subscription-management.ts) resolve a subscription
 * exclusivamente pelo `user.id` da sessão — nunca aceita `subscriptionId`
 * do body.
 *
 * Sincroniza `subscriptions` localmente chamando `syncSubscriptionFromStripe`
 * (a MESMA função que o webhook usa, Stripe 5.4B) logo após a chamada ao
 * Stripe — nunca duplica a lógica de sincronização, só a reaproveita de
 * forma eager para o estado local já refletir a mudança na resposta desta
 * rota, sem depender da latência/disponibilidade de entrega do webhook
 * neste ambiente. Quando o `customer.subscription.updated` correspondente
 * chegar de verdade, ele reprocessa o MESMO estado canônico — replay
 * seguro, nunca uma segunda transição.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertDevProject } from '@/lib/supabase/assert-dev-project'
import { clientEnv } from '@/lib/env.server'
import { getStripeClient } from '@/lib/stripe/client'
import { cancelOwnSubscription } from '@/lib/stripe/subscription-management'
import { syncSubscriptionFromStripe } from '@/lib/stripe/subscription-sync'

export async function POST() {
  try {
    assertDevProject(clientEnv.NEXT_PUBLIC_SUPABASE_URL)
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

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Configuração do Stripe indisponível.' }, { status: 500 })
  }

  const adminClient = getSupabaseAdminClient()

  try {
    const subscription = await cancelOwnSubscription(adminClient, stripe, user.id)
    await syncSubscriptionFromStripe(adminClient, stripe, subscription.id, null)

    return NextResponse.json({ success: true })
  } catch (err) {
    Sentry.captureException(err)
    const message = err instanceof Error ? err.message : 'Falha ao cancelar a assinatura.'
    const isOwnershipError = message.includes('Nenhuma subscription elegível')
    return NextResponse.json({ error: isOwnershipError ? message : 'Falha ao cancelar a assinatura.' }, { status: isOwnershipError ? 404 : 500 })
  }
}
