/**
 * components/billing/PricingSelector.tsx
 * Etapa "5.10D — Billing Commercial Foundation" — seleção de plano/intervalo
 * da nova página de pricing. O catálogo (preços reais) e a moeda (resolvida
 * via `resolveCurrencyFromCountryCode`) SEMPRE vêm do Server Component pai
 * — este componente nunca inventa preço, nunca decide moeda, nunca envia
 * `stripe_price_id`. Upgrade a partir do Free reaproveita exatamente
 * `UpgradeToProDialog` (mesmo componente/mesmo contrato de
 * `/api/billing/checkout` já usado pelo paywall de limite de coleção/
 * Dashboard avançado — nenhum segundo fluxo de Checkout). Mudança entre
 * planos pagos (Pro↔Premium) e cancelamento (→Free) reaproveitam as rotas
 * já existentes (`/api/billing/subscription/change-plan`,
 * `/api/billing/subscription/cancel`) — nenhum endpoint novo, nenhuma
 * lógica de proration/agendamento reimplementada aqui (a UI só inicia a
 * ação correta e exibe o resultado que o servidor já calcula).
 */
'use client'

import { useState } from 'react'
import { RefreshCcw } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'

import { PlanCard } from './PlanCard'
import { UpgradeToProDialog } from './UpgradeToProDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatPrice } from '@/lib/format/currency'
import { computeYearlySavingsPercent } from '@/lib/stripe/pricing-display'
import type { CommercialPlanPrice, PaidPlanSlug, PriceCurrency, PriceInterval } from '@/lib/stripe/catalog'

export interface PricingSelectorProps {
  catalog: CommercialPlanPrice[]
  currentPlanSlug: string
  currency: PriceCurrency
}

const PLAN_NAMES: Record<'free' | PaidPlanSlug, string> = {
  free: 'Free',
  pro: 'Pro',
  premium: 'Premium',
}

const PLAN_BENEFITS: Record<'free' | PaidPlanSlug, string[]> = {
  free: ['Até 50 moedas ativas na coleção', 'Passport público'],
  pro: ['Coleção ilimitada', 'Dashboard avançado', 'Numora Labels'],
  premium: ['Tudo do Pro'],
}

type ChangeAction = { kind: 'downgrade-to-free' } | { kind: 'change-plan'; targetPlanSlug: PaidPlanSlug }

function findPrice(catalog: CommercialPlanPrice[], planSlug: PaidPlanSlug, interval: PriceInterval, currency: PriceCurrency): CommercialPlanPrice | null {
  return catalog.find((row) => row.planSlug === planSlug && row.interval === interval && row.currency === currency && row.active) ?? null
}

export function PricingSelector({ catalog, currentPlanSlug, currency }: PricingSelectorProps) {
  const [interval, setInterval] = useState<PriceInterval>('month')
  const [checkoutTarget, setCheckoutTarget] = useState<PaidPlanSlug | null>(null)
  const [changeAction, setChangeAction] = useState<ChangeAction | null>(null)
  const [isChanging, setIsChanging] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

  const monthlyPro = findPrice(catalog, 'pro', 'month', currency)
  const yearlyPro = findPrice(catalog, 'pro', 'year', currency)
  const monthlyPremium = findPrice(catalog, 'premium', 'month', currency)
  const yearlyPremium = findPrice(catalog, 'premium', 'year', currency)

  const proPrice = interval === 'month' ? monthlyPro : yearlyPro
  const premiumPrice = interval === 'month' ? monthlyPremium : yearlyPremium

  // Etapa 5.10D — economia sempre derivada dos 2 preços reais do
  // catálogo, nunca um percentual fixo. `null` quando alguma das duas
  // combinações não está disponível (nunca inventa um número).
  const proSavingsPercent = monthlyPro && yearlyPro ? computeYearlySavingsPercent(monthlyPro.amount, yearlyPro.amount) : null
  const premiumSavingsPercent = monthlyPremium && yearlyPremium ? computeYearlySavingsPercent(monthlyPremium.amount, yearlyPremium.amount) : null

  function ctaFor(targetPlanSlug: PaidPlanSlug): { label: string; disabled: boolean; onClick?: () => void } {
    if (currentPlanSlug === targetPlanSlug) {
      return { label: 'Plano atual', disabled: true }
    }

    if (currentPlanSlug === 'free') {
      return { label: 'Fazer upgrade', disabled: false, onClick: () => setCheckoutTarget(targetPlanSlug) }
    }

    // pro→premium ou premium→pro: sempre "change-plan" (upgrade imediato
    // com proration, ou downgrade agendado — decidido pelo servidor,
    // nunca aqui) — NUNCA passa pelo Checkout.
    return {
      label: targetPlanSlug === 'premium' ? 'Fazer upgrade' : 'Fazer downgrade',
      disabled: false,
      onClick: () => setChangeAction({ kind: 'change-plan', targetPlanSlug }),
    }
  }

  const freeCta =
    currentPlanSlug === 'free'
      ? { label: 'Plano atual', disabled: true, onClick: undefined }
      : { label: 'Fazer downgrade', disabled: false, onClick: () => setChangeAction({ kind: 'downgrade-to-free' }) }

  const proCta = ctaFor('pro')
  const premiumCta = ctaFor('premium')

  async function confirmChange() {
    if (!changeAction) return

    setIsChanging(true)
    setChangeError(null)

    try {
      const response =
        changeAction.kind === 'downgrade-to-free'
          ? await fetch('/api/billing/subscription/cancel', { method: 'POST' })
          : await fetch('/api/billing/subscription/change-plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ planSlug: changeAction.targetPlanSlug, interval, currency }),
            })

      const body: { error?: string } | null = await response.json().catch(() => null)

      if (!response.ok) {
        setChangeError(body?.error ?? 'Não foi possível concluir a alteração agora. Tente novamente.')
        setIsChanging(false)
        return
      }

      // Sucesso — recarrega a página para refletir o plano/entitlement
      // atualizado (a mesma fonte de verdade, `get_effective_plan()`, que
      // o Server Component pai já usa).
      window.location.reload()
    } catch (err) {
      Sentry.captureException(err)
      setChangeError('Não foi possível concluir a alteração agora. Tente novamente.')
      setIsChanging(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center gap-2" role="radiogroup" aria-label="Intervalo de cobrança">
        <button
          type="button"
          role="radio"
          aria-checked={interval === 'month'}
          onClick={() => setInterval('month')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            interval === 'month' ? 'bg-accent text-background' : 'bg-surface-hover text-text-secondary'
          }`}
        >
          Mensal
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={interval === 'year'}
          onClick={() => setInterval('year')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            interval === 'year' ? 'bg-accent text-background' : 'bg-surface-hover text-text-secondary'
          }`}
        >
          Anual
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <PlanCard
          name={PLAN_NAMES.free}
          priceLabel={null}
          benefits={PLAN_BENEFITS.free}
          isCurrentPlan={currentPlanSlug === 'free'}
          ctaLabel={freeCta.label}
          ctaDisabled={freeCta.disabled}
          onCtaClick={freeCta.onClick}
        />
        <PlanCard
          name={PLAN_NAMES.pro}
          priceLabel={proPrice ? formatPrice(proPrice.amount, currency) : null}
          intervalLabel={proPrice ? (interval === 'month' ? '/mês' : '/ano') : undefined}
          benefits={PLAN_BENEFITS.pro}
          isCurrentPlan={currentPlanSlug === 'pro'}
          ctaLabel={proCta.label}
          ctaDisabled={proCta.disabled || !proPrice}
          onCtaClick={proCta.onClick}
          highlighted
          yearlySavingsPercent={interval === 'year' ? proSavingsPercent : null}
        />
        <PlanCard
          name={PLAN_NAMES.premium}
          priceLabel={premiumPrice ? formatPrice(premiumPrice.amount, currency) : null}
          intervalLabel={premiumPrice ? (interval === 'month' ? '/mês' : '/ano') : undefined}
          benefits={PLAN_BENEFITS.premium}
          isCurrentPlan={currentPlanSlug === 'premium'}
          ctaLabel={premiumCta.label}
          ctaDisabled={premiumCta.disabled || !premiumPrice}
          onCtaClick={premiumCta.onClick}
          yearlySavingsPercent={interval === 'year' ? premiumSavingsPercent : null}
        />
      </div>

      {(!proPrice || !premiumPrice) && (
        <p className="text-center text-sm text-text-secondary">
          Algumas combinações de plano/intervalo/moeda ainda não estão disponíveis para compra.
        </p>
      )}

      {checkoutTarget && (
        <UpgradeToProDialog
          isOpen={checkoutTarget !== null}
          onClose={() => setCheckoutTarget(null)}
          title={`Assinar o plano ${PLAN_NAMES[checkoutTarget]}`}
          trigger="pricing_page"
          planSlug={currentPlanSlug}
          targetPlanSlug={checkoutTarget}
          interval={interval}
          currency={currency}
        />
      )}

      <ConfirmDialog
        isOpen={changeAction !== null}
        onClose={() => {
          if (isChanging) return
          setChangeAction(null)
          setChangeError(null)
        }}
        onConfirm={confirmChange}
        title={changeAction?.kind === 'downgrade-to-free' ? 'Cancelar assinatura' : 'Confirmar mudança de plano'}
        description={
          changeAction?.kind === 'downgrade-to-free'
            ? 'Seu acesso Pro/Premium continua até o fim do período já pago — depois disso, sua conta volta ao plano Free.'
            : 'A mudança de plano segue as regras já aprovadas: upgrade é imediato (com cobrança proporcional), downgrade só entra em vigor no fim do período atual.'
        }
        confirmLabel={changeAction?.kind === 'downgrade-to-free' ? 'Cancelar assinatura' : 'Confirmar'}
        icon={RefreshCcw}
        isLoading={isChanging}
        error={changeError}
      />
    </div>
  )
}
