/**
 * components/billing/PricingSelector.tsx
 * Etapa "5.10D — Billing Commercial Foundation" — seleção de plano/intervalo
 * da nova página de pricing. O catálogo (preços reais) SEMPRE vem do Server
 * Component pai — este componente nunca inventa preço, nunca decide moeda,
 * nunca envia `stripe_price_id`. Upgrade a partir do Free reaproveita
 * exatamente `UpgradeToProDialog` (mesmo componente/mesmo contrato de
 * `/api/billing/checkout` já usado pelo paywall de limite de coleção/
 * Dashboard avançado — nenhum segundo fluxo de Checkout). Cancelamento
 * (→Free) e downgrade Premium→Pro reaproveitam as rotas já existentes
 * (`/api/billing/subscription/change-plan`, `/api/billing/subscription/cancel`)
 * — nenhum endpoint novo, nenhuma lógica de proration/agendamento
 * reimplementada aqui (a UI só inicia a ação correta e exibe o resultado que
 * o servidor já calcula).
 *
 * Etapa "Official Launch Foundation — Bloco A": o Premium NÃO é vendido
 * (D1/D2 — `lib/billing/plan-availability.ts`). O card do Premium mostra o
 * preço do catálogo, o badge "Em breve" e um único CTA, "Quero ser
 * avisado", que só registra `plan_interest` — nunca abre Checkout, nunca
 * inicia troca de plano (Pro→Premium), nunca depende de `price.active`. A
 * barreira real é a do servidor; esta UI apenas não oferece o caminho.
 *
 * Preço exibido vs. preço contratável: o valor MOSTRADO vem do catálogo
 * mesmo quando a linha ainda está `active=false` (Production hoje, antes do
 * Stripe LIVE) — nunca um card de plano pago com "Grátis" por falta de
 * preço ativo. Já a habilitação do CTA de compra do Pro continua exigindo
 * uma linha `active=true` (estado real de venda), sem mascarar a
 * indisponibilidade.
 *
 * Etapa "B1 — Official Launch, código de cobrança": V1 comercial é
 * SOMENTE Brasil/BRL (lib/billing/purchase-eligibility.ts). O Server
 * Component pai passa `purchaseAvailability` (derivado do país do perfil) e
 * o catálogo é sempre exibido em BRL. Para um usuário Free:
 *   - país ausente → o CTA do Pro vira "Informar país" (link para o
 *     perfil), sem cobrança;
 *   - país ≠ BR → o Pro mostra "disponível apenas no Brasil por enquanto" e
 *     o CTA registra `plan_interest` (mesmo mecanismo do Premium), sem
 *     Checkout e sem USD como alternativa.
 * É só apresentação: a barreira real é `evaluatePurchaseEligibility` no
 * servidor (checkout e change-plan).
 */
'use client'

import { useEffect, useState } from 'react'
import { RefreshCcw } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'

import { PlanCard } from './PlanCard'
import { UpgradeToProDialog } from './UpgradeToProDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatPrice } from '@/lib/format/currency'
import { FREE_BENEFITS, PREMIUM_BENEFITS, PRO_BENEFITS } from '@/lib/billing/plan-benefits'
import { type PurchasablePlanSlug } from '@/lib/billing/plan-availability'
import { PURCHASE_COUNTRY_MISSING_MESSAGE, PURCHASE_REGION_UNAVAILABLE_MESSAGE, type PurchaseAvailability } from '@/lib/billing/purchase-eligibility'
import { trackUpgradeInterestRegistered } from '@/lib/analytics/events/paywall-events'
import { createSupabasePlanInterestRepository } from '@/features/billing/repositories/plan-interest.repository'
import { computeYearlySavingsPercent } from '@/lib/stripe/pricing-display'
import type { CommercialPlanPrice, PaidPlanSlug, PriceCurrency, PriceInterval } from '@/lib/stripe/catalog'

// Módulo-escopo (mesmo padrão de UpgradeToProDialog) — uma única instância por sessão de browser.
const planInterestRepository = createSupabasePlanInterestRepository()

export interface PricingSelectorProps {
  catalog: CommercialPlanPrice[]
  currentPlanSlug: string
  currency: PriceCurrency
  /** B1 — derivado no servidor do país do perfil (só apresentação; a barreira real é a do servidor). */
  purchaseAvailability: PurchaseAvailability
}

const PLAN_NAMES: Record<'free' | PaidPlanSlug, string> = {
  free: 'Free',
  pro: 'Pro',
  premium: 'Premium',
}

const INTEREST_ERROR_MESSAGE = 'Não foi possível registrar seu interesse agora. Tente novamente.'
const PROFILE_HREF = '/dashboard/profile'

/** Downgrade Premium→Pro é a única troca de plano suportada — o destino é sempre um plano contratável (Pro). */
type ChangeAction = { kind: 'downgrade-to-free' } | { kind: 'change-plan'; targetPlanSlug: PurchasablePlanSlug }

/** Linha do catálogo para EXIBIÇÃO — ativa ou não (o preço mostrado nunca depende de o plano estar à venda). */
function findDisplayPrice(catalog: CommercialPlanPrice[], planSlug: PaidPlanSlug, interval: PriceInterval, currency: PriceCurrency): CommercialPlanPrice | null {
  return catalog.find((row) => row.planSlug === planSlug && row.interval === interval && row.currency === currency) ?? null
}

/** Linha do catálogo CONTRATÁVEL: só se estiver `active` (estado real de venda). */
function findActivePrice(catalog: CommercialPlanPrice[], planSlug: PaidPlanSlug, interval: PriceInterval, currency: PriceCurrency): CommercialPlanPrice | null {
  const row = findDisplayPrice(catalog, planSlug, interval, currency)
  return row?.active ? row : null
}

interface PlanInterestState {
  registered: boolean
  isChecking: boolean
  isRegistering: boolean
  error: string | null
}

/**
 * Sinal de interesse ("Quero ser avisado") por plano — só grava em
 * `plan_interest`, NUNCA chama Checkout/Stripe nem redireciona. Usado para o
 * Premium ("Em breve") e para o Pro fora do Brasil (B1). `enabled=false` não
 * consulta nada. A UNIQUE(user_id, plan_slug) do banco garante a
 * idempotência; o evento só dispara DEPOIS do register() confirmado.
 */
function usePlanInterest(planSlug: 'pro' | 'premium', source: string, currency: PriceCurrency, enabled: boolean) {
  const [state, setState] = useState<PlanInterestState>({ registered: false, isChecking: enabled, isRegistering: false, error: null })

  // Reflete "Você está na lista de interesse" já ao carregar a página. Falha aqui nunca bloqueia nada (o CTA continua disponível).
  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    planInterestRepository
      .getStatus(planSlug)
      .then((status) => {
        if (!cancelled) setState((previous) => ({ ...previous, registered: status.registered }))
      })
      .catch((err) => {
        Sentry.captureException(err)
      })
      .finally(() => {
        if (!cancelled) setState((previous) => ({ ...previous, isChecking: false }))
      })

    return () => {
      cancelled = true
    }
  }, [planSlug, enabled])

  async function register() {
    // Idempotência também no client (a UNIQUE do banco garante no limite).
    if (state.registered || state.isRegistering) return

    setState((previous) => ({ ...previous, error: null, isRegistering: true }))

    try {
      // Nunca chama /api/billing/checkout, nunca toca Stripe — só grava em plan_interest.
      await planInterestRepository.register({ planSlug, source })
      setState((previous) => ({ ...previous, registered: true }))

      try {
        trackUpgradeInterestRegistered({ trigger: 'pricing_page', plan_slug: planSlug, currency })
      } catch (err) {
        Sentry.captureException(err)
      }
    } catch (err) {
      Sentry.captureException(err)
      setState((previous) => ({ ...previous, error: INTEREST_ERROR_MESSAGE }))
    } finally {
      setState((previous) => ({ ...previous, isRegistering: false }))
    }
  }

  const label = state.isRegistering ? 'Registrando...' : state.registered ? 'Você está na lista de interesse' : 'Quero ser avisado'
  const disabled = state.registered || state.isChecking || state.isRegistering

  return { state, register, label, disabled }
}

export function PricingSelector({ catalog, currentPlanSlug, currency, purchaseAvailability }: PricingSelectorProps) {
  const [interval, setInterval] = useState<PriceInterval>('month')
  const [checkoutTarget, setCheckoutTarget] = useState<PurchasablePlanSlug | null>(null)
  const [changeAction, setChangeAction] = useState<ChangeAction | null>(null)
  const [isChanging, setIsChanging] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

  // B1 — a disponibilidade regional só afeta quem ainda é Free (o caminho de upgrade); assinantes usam change-plan/cancel, validados no servidor.
  const isFreeUser = currentPlanSlug === 'free'
  const showCountryMissing = isFreeUser && purchaseAvailability === 'country_missing'
  const showRegionUnavailable = isFreeUser && purchaseAvailability === 'country_not_supported'
  const canStartCheckout = !isFreeUser || purchaseAvailability === 'eligible'

  const premiumInterest = usePlanInterest('premium', 'pricing_page', currency, true)
  const proRegionInterest = usePlanInterest('pro', 'region_unavailable', currency, showRegionUnavailable)
  const handleRegisterPremiumInterest = premiumInterest.register

  const proDisplayPrice = findDisplayPrice(catalog, 'pro', interval, currency)
  const proActivePrice = findActivePrice(catalog, 'pro', interval, currency)
  const premiumDisplayPrice = findDisplayPrice(catalog, 'premium', interval, currency)

  // Etapa 5.10D — economia sempre derivada dos 2 preços reais do
  // catálogo, nunca um percentual fixo. `null` quando alguma das duas
  // combinações não existe (nunca inventa um número).
  const monthlyPro = findDisplayPrice(catalog, 'pro', 'month', currency)
  const yearlyPro = findDisplayPrice(catalog, 'pro', 'year', currency)
  const monthlyPremium = findDisplayPrice(catalog, 'premium', 'month', currency)
  const yearlyPremium = findDisplayPrice(catalog, 'premium', 'year', currency)
  const proSavingsPercent = monthlyPro && yearlyPro ? computeYearlySavingsPercent(monthlyPro.amount, yearlyPro.amount) : null
  const premiumSavingsPercent = monthlyPremium && yearlyPremium ? computeYearlySavingsPercent(monthlyPremium.amount, yearlyPremium.amount) : null

  function proCta(): { label: string; disabled: boolean; onClick?: () => void; href?: string } {
    if (currentPlanSlug === 'pro') {
      return { label: 'Plano atual', disabled: true }
    }

    if (currentPlanSlug === 'free') {
      if (showCountryMissing) {
        // Sem país no perfil: só navega até o perfil — nenhum caminho de cobrança.
        return { label: 'Informar país', disabled: false, href: PROFILE_HREF }
      }
      if (showRegionUnavailable) {
        return { label: proRegionInterest.label, disabled: proRegionInterest.disabled, onClick: proRegionInterest.register }
      }
      return { label: 'Fazer upgrade', disabled: false, onClick: () => setCheckoutTarget('pro') }
    }

    // premium→pro: sempre "change-plan" (downgrade agendado, decidido pelo
    // servidor, nunca aqui) — NUNCA passa pelo Checkout.
    return { label: 'Fazer downgrade', disabled: false, onClick: () => setChangeAction({ kind: 'change-plan', targetPlanSlug: 'pro' }) }
  }

  const freeCta =
    currentPlanSlug === 'free'
      ? { label: 'Plano atual', disabled: true, onClick: undefined }
      : { label: 'Fazer downgrade', disabled: false, onClick: () => setChangeAction({ kind: 'downgrade-to-free' }) }

  const proCtaState = proCta()
  // "Informar país" e o interesse regional não dependem de haver preço ativo; só o upgrade/downgrade reais dependem.
  const proCtaNeedsActivePrice = !proCtaState.href && !showRegionUnavailable

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
          benefits={[...FREE_BENEFITS]}
          isCurrentPlan={currentPlanSlug === 'free'}
          ctaLabel={freeCta.label}
          ctaDisabled={freeCta.disabled}
          onCtaClick={freeCta.onClick}
        />
        <PlanCard
          name={PLAN_NAMES.pro}
          priceLabel={proDisplayPrice ? formatPrice(proDisplayPrice.amount, currency) : 'Preço indisponível'}
          intervalLabel={proDisplayPrice ? (interval === 'month' ? '/mês' : '/ano') : undefined}
          benefits={[...PRO_BENEFITS]}
          isCurrentPlan={currentPlanSlug === 'pro'}
          ctaLabel={proCtaState.label}
          ctaDisabled={proCtaState.disabled || (proCtaNeedsActivePrice && !proActivePrice)}
          onCtaClick={proCtaState.onClick}
          ctaHref={proCtaState.href}
          highlighted
          yearlySavingsPercent={interval === 'year' ? proSavingsPercent : null}
          footnote={showRegionUnavailable ? proRegionInterest.state.error : null}
        />
        <PlanCard
          name={PLAN_NAMES.premium}
          priceLabel={premiumDisplayPrice ? formatPrice(premiumDisplayPrice.amount, currency) : 'Preço indisponível'}
          intervalLabel={premiumDisplayPrice ? (interval === 'month' ? '/mês' : '/ano') : undefined}
          benefits={[...PREMIUM_BENEFITS]}
          isCurrentPlan={currentPlanSlug === 'premium'}
          ctaLabel={premiumInterest.label}
          ctaDisabled={premiumInterest.disabled}
          onCtaClick={handleRegisterPremiumInterest}
          comingSoon
          yearlySavingsPercent={interval === 'year' ? premiumSavingsPercent : null}
          footnote={premiumInterest.state.error ?? 'Ainda não disponível para contratação.'}
        />
      </div>

      {showCountryMissing && <p className="text-center text-sm text-text-secondary">{PURCHASE_COUNTRY_MISSING_MESSAGE}</p>}
      {showRegionUnavailable && <p className="text-center text-sm text-text-secondary">{PURCHASE_REGION_UNAVAILABLE_MESSAGE}</p>}
      {canStartCheckout && !proActivePrice && (
        <p className="text-center text-sm text-text-secondary">A contratação do plano Pro ainda não está disponível para este período/moeda.</p>
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
            : 'O downgrade só entra em vigor no fim do período atual — até lá, você continua com o plano atual.'
        }
        confirmLabel={changeAction?.kind === 'downgrade-to-free' ? 'Cancelar assinatura' : 'Confirmar'}
        icon={RefreshCcw}
        isLoading={isChanging}
        error={changeError}
      />
    </div>
  )
}
