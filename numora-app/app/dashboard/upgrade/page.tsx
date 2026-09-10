/**
 * app/dashboard/upgrade/page.tsx
 * Etapa "5.10D — Billing Commercial Foundation" — página de seleção de
 * plano (Free/Pro/Premium × mensal/anual × BRL/USD). Server Component:
 * busca o catálogo real (`getCommercialPlanPricesCatalog`, mesma função já
 * usada por `/api/billing/checkout`), o plano efetivo (`get_effective_plan`,
 * mesma RPC do Dashboard) e `profiles.country_code` (para resolver a moeda
 * via `resolveCurrencyFromCountryCode` — nunca geolocalização). Toda a
 * autoridade de preço continua no servidor: esta página só lê o mesmo
 * catálogo que `/api/billing/checkout` valida contra antes de criar
 * qualquer Checkout Session.
 */
import { redirect } from 'next/navigation'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getCommercialPlanPricesCatalog } from '@/lib/stripe/catalog'
import { resolveCurrencyFromCountryCode } from '@/lib/stripe/resolve-currency'
import { PageHeader } from '@/components/ui/PageHeader'
import { PricingSelector } from '@/components/billing/PricingSelector'
import { ErrorState } from '@/components/ui/ErrorState'

export const metadata = {
  title: 'Planos — Numora',
}

export default async function UpgradePage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [catalogResult, profileResult, effectivePlanResult] = await Promise.allSettled([
    getCommercialPlanPricesCatalog(supabase),
    supabase.from('profiles').select('country_code').eq('id', user.id).maybeSingle(),
    supabase.rpc('get_effective_plan', { p_user_id: user.id }).maybeSingle(),
  ])

  if (catalogResult.status === 'rejected') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Planos" description="Escolha o plano ideal para sua coleção." />
        <ErrorState title="Não foi possível carregar o catálogo de planos agora." />
      </div>
    )
  }

  const countryCode =
    profileResult.status === 'fulfilled' ? ((profileResult.value.data as { country_code: string | null } | null)?.country_code ?? null) : null
  const currency = resolveCurrencyFromCountryCode(countryCode)

  const currentPlanSlug =
    effectivePlanResult.status === 'fulfilled' ? ((effectivePlanResult.value.data as { plan_slug: string } | null)?.plan_slug ?? 'free') : 'free'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Planos" description="Colecione sem limites." />
      <PricingSelector catalog={catalogResult.value} currentPlanSlug={currentPlanSlug} currency={currency} />
    </div>
  )
}
