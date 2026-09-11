/**
 * app/api/billing/customer/route.ts
 * Etapa "Stripe 5.2 — Customer Foundation" — obtém (criando se necessário)
 * o Stripe Customer do usuário autenticado. NÃO implementa Checkout,
 * Webhooks, Subscription ou Customer Portal — só garante o vínculo
 * profiles ↔ billing_customers ↔ Stripe Customer, preparando o terreno
 * para as fases seguintes.
 *
 * Único caminho de escrita em `billing_customers`: a tabela não tem
 * NENHUMA policy de INSERT/UPDATE para usuário comum (só
 * `is_platform_owner()` — migration `20260817110200_create_billing_customers.sql`)
 * — por isso esta rota usa `service_role`, exatamente como
 * `app/api/account/delete/route.ts` (única outra rota que precisa disso).
 *
 * `assertDevProject` roda ANTES de qualquer chamada Stripe/Supabase
 * privilegiada: a fundação de Customer ainda não foi aprovada para
 * Production nesta etapa — falha fechado se `NEXT_PUBLIC_SUPABASE_URL`
 * apontar para qualquer projeto que não seja DEV.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertBillingEnvironment, gatherBillingEnvironmentContext } from '@/lib/billing/assert-billing-environment'
import { getStripeClient } from '@/lib/stripe/client'
import { getOrCreateBillingCustomer } from '@/lib/stripe/customer'

export async function POST() {
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

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Configuração do Stripe indisponível.' }, { status: 500 })
  }

  const adminClient = getSupabaseAdminClient()

  try {
    const result = await getOrCreateBillingCustomer(adminClient, stripe, {
      userId: user.id,
      email: user.email ?? null,
    })

    return NextResponse.json({ billingCustomerId: result.billingCustomerId })
  } catch (err) {
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Falha ao obter o Customer de cobrança.' }, { status: 500 })
  }
}
