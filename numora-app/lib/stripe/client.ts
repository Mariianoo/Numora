/**
 * lib/stripe/client.ts
 * Etapa "Stripe 4.1A" — fábrica do client oficial do Stripe, sempre
 * server-only. Mesmo padrão de `lib/supabase/admin.ts`: uma função
 * `get*Client()` (nunca um singleton em nível de módulo), lendo a chave
 * exclusivamente de `getStripeEnv()` (nunca de `clientEnv`), validando
 * TEST MODE via `assertStripeTestMode()` ANTES de instanciar o SDK.
 *
 * NUNCA importar este arquivo de um Client Component ou de qualquer código
 * que possa acabar no bundle do browser — só de código que roda
 * exclusivamente no servidor (Server Actions, Route Handlers, scripts
 * Node). Nada aqui loga a chave nem qualquer header de autenticação — o
 * próprio SDK do Stripe também nunca inclui a secret key no corpo de
 * nenhuma resposta.
 *
 * Etapa "Stripe 4.1A" é só preparação — nenhuma chamada ao Stripe
 * acontece a partir deste arquivo nem de nenhum outro criado nesta etapa.
 */
import Stripe from 'stripe'

import { getStripeEnv } from '@/lib/env.stripe.server'
import { assertStripeTestMode } from './assert-test-mode'

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia'

export function getStripeClient(): Stripe {
  const { STRIPE_SECRET_KEY } = getStripeEnv()

  assertStripeTestMode(STRIPE_SECRET_KEY)

  return new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
  })
}
