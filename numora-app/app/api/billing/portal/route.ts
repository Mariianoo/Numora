/**
 * app/api/billing/portal/route.ts
 * Etapa "Stripe 5.6 — Customer Portal" — cria uma Stripe Billing Portal
 * Session para o usuário autenticado e devolve a URL para o cliente
 * redirecionar. Mesmo padrão de segurança de
 * app/api/billing/customer/route.ts e app/api/billing/checkout/route.ts:
 * sessão real → `user.id` → `getOrCreateBillingCustomer` (nunca aceita
 * `stripe_customer_id` do body) → Stripe.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertDevProject } from '@/lib/supabase/assert-dev-project'
import { clientEnv } from '@/lib/env.server'
import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'
import { createBillingPortalSession } from '@/lib/stripe/portal'

function resolveAppOrigin(request: Request): string {
  if (clientEnv.NEXT_PUBLIC_SITE_URL) {
    return clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  return new URL(request.url).origin
}

export async function POST(request: Request) {
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
    const billingCustomer = await getOrCreateBillingCustomer(adminClient, stripe, { userId: user.id, email: user.email ?? null })
    const origin = resolveAppOrigin(request)
    const session = await createBillingPortalSession(stripe, {
      stripeCustomerId: billingCustomer.stripeCustomerId,
      returnUrl: `${origin}/dashboard/profile`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Falha ao abrir o portal de cobrança.' }, { status: 500 })
  }
}
