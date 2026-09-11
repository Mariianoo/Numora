/**
 * lib/stripe/client.ts
 * Etapa "Stripe 4.1A" — fábrica do client oficial do Stripe, sempre
 * server-only. Mesmo padrão de `lib/supabase/admin.ts`: uma função
 * `get*Client()` (nunca um singleton em nível de módulo), lendo a chave
 * exclusivamente de `getStripeEnv()` (nunca de `clientEnv`).
 *
 * Etapa "5.10Q-A — Live Billing Guards": a validação de modo passou de
 * `assertStripeTestMode()` (só sabia "bloquear LIVE sempre") para
 * `assertBillingEnvironment()` (sabe distinguir "LIVE nunca permitido" de
 * "LIVE permitido sob as 4 condições cumulativas", auditoria 5.10O). Esta
 * função é o ÚNICO ponto do código que instancia o SDK do Stripe — ao
 * validar aqui, NENHUM chamador (as 6 rotas de billing, e também
 * `cancelAllStripeSubscriptionsForAccountDeletion` via
 * `app/api/account/delete/route.ts`, que nunca teve nenhum guard próprio
 * antes desta etapa) pode obter um client sem passar por este boundary —
 * mesmo que um chamador futuro esqueça de chamar o guard explicitamente
 * antes. Defesa em profundidade: as rotas TAMBÉM chamam
 * `assertBillingEnvironment` explicitamente (ver cada `route.ts`), mas a
 * garantia real e inescapável mora aqui.
 *
 * NUNCA importar este arquivo de um Client Component ou de qualquer código
 * que possa acabar no bundle do browser — só de código que roda
 * exclusivamente no servidor (Server Actions, Route Handlers, scripts
 * Node). Nada aqui loga a chave nem qualquer header de autenticação — o
 * próprio SDK do Stripe também nunca inclui a secret key no corpo de
 * nenhuma resposta.
 */
import Stripe from 'stripe'

import { getStripeEnv } from '@/lib/env.stripe.server'
import { assertBillingEnvironment, gatherBillingEnvironmentContext } from '@/lib/billing/assert-billing-environment'

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia'

export function getStripeClient(): Stripe {
  const { STRIPE_SECRET_KEY } = getStripeEnv()

  assertBillingEnvironment(gatherBillingEnvironmentContext())

  return new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
  })
}
