/**
 * components/billing/UpgradeToProDialog.tsx
 * Etapa "5.9D — Paywall UX" — Paywall reutilizável para o limite de 50
 * `collection_items` (Coleção/Lixeira) e para o gate de Dashboard avançado
 * (Etapa 5.9C, que antes só linkava para `/dashboard/profile`). Um único
 * componente, um único CTA — nunca um segundo fluxo de Checkout: chama
 * exatamente `POST /api/billing/checkout` (Stripe 5.3, inalterado), que já
 * resolve preço/moeda/Price/Customer inteiramente no servidor. O frontend
 * só informa `planSlug`/`interval`/`currency` — nunca um `priceId`/
 * `customerId`.
 *
 * Envolve `Modal` (nunca reimplementa overlay/Escape/focus trap/pilha) —
 * mesma acessibilidade de todo modal do app. Sem CTA secundário: o X e o
 * Escape do próprio `Modal` já bastam para dispensar, sem competir com o
 * CTA principal.
 *
 * Mensagem estratégica (nunca copy de urgência falsa): limite atual,
 * "coleção intacta, nada será apagado", "Pro remove o limite" — o número
 * do limite vem de `limitValue` (passado pelo caller, que o obteve de
 * `check_collection_item_limit()`) — NUNCA hardcoded aqui, para nunca
 * divergir se o valor de `plan_entitlements` mudar no futuro.
 *
 * Etapa "5.9E — Analytics": único ponto de disparo de `upgrade_viewed`
 * (todo caller passa por aqui, então instrumentar aqui cobre Coleção/
 * Lixeira/Dashboard de uma vez, sem duplicar lógica em cada chamador) e de
 * `checkout_started` (só depois de `/api/billing/checkout` responder com
 * sucesso e uma `url` válida — nunca no clique bruto). `trigger`/`planSlug`
 * são SEMPRE resolvidos pelo caller a partir de uma fonte de entitlement
 * real (nunca uma string fixa aqui) — ver comentário de
 * `lib/analytics/events/paywall-events.ts`. Analytics é best-effort: uma
 * falha em `trackUpgradeViewed`/`trackCheckoutStarted` nunca impede o
 * Paywall de abrir nem o upgrade de prosseguir (try/catch → Sentry, mesmo
 * padrão de `CollectionRepository.create()`).
 *
 * Etapa "5.10D — Billing Commercial Foundation": `targetPlanSlug`/
 * `interval`/`currency` (o que efetivamente é comprado) deixam de ser
 * constantes fixas (`UPGRADE_PLAN_SLUG`/`UPGRADE_INTERVAL`/`UPGRADE_CURRENCY`)
 * e passam a ser props — resolvidas pelo caller (`resolveCurrencyFromCountryCode`
 * para moeda; intervalo/plano-alvo continuam 'month'/'pro' nos 3 pontos de
 * entrada contextuais já existentes, que nunca ofereciam Premium/anual —
 * ver relatório da etapa). `planSlug` (prop já existente) continua
 * representando o PLANO ATUAL do usuário, usado só por `upgrade_viewed` —
 * nunca confundir com `targetPlanSlug` (o plano sendo comprado, usado no
 * request de Checkout e em `checkout_started`).
 *
 * Etapa "5.10S — Pro Interest / Pré-lançamento": segunda ação, "Quero ser
 * avisado" — sempre ao lado do CTA de Checkout, nunca o substituindo.
 * Nunca chama /api/billing/checkout, nunca toca Stripe, nunca altera
 * estado de billing — só grava em plan_interest
 * (features/billing/repositories/plan-interest.repository.ts) usando o
 * mesmo targetPlanSlug sendo apresentado (nunca hardcoded 'pro') e o
 * mesmo trigger já usado por upgrade_viewed/checkout_started como source
 * (nenhuma taxonomia paralela). Idempotente e refletido já na abertura do
 * diálogo (getStatus) — clicar de novo, ou reabrir o diálogo depois de já
 * ter registrado, nunca duplica nem gera erro visível.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { getConsent } from '@/lib/analytics/consent'
import { trackCheckoutStarted, trackUpgradeInterestRegistered, trackUpgradeViewed, type UpgradeViewedTrigger } from '@/lib/analytics/events/paywall-events'
import { createSupabasePlanInterestRepository } from '@/features/billing/repositories/plan-interest.repository'
import type { PaidPlanSlug, PriceCurrency, PriceInterval } from '@/lib/stripe/catalog'

// Módulo-escopo (mesmo padrão de createSupabaseFeedbackRepository() em
// app/dashboard/feedback/page.tsx) — uma única instância para todos os
// diálogos montados nesta sessão de browser, nunca recriada por render.
const planInterestRepository = createSupabasePlanInterestRepository()

export interface UpgradeToProDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Título contextual (ex.: "Você atingiu o limite de moedas"). Um padrão genérico é usado se omitido. */
  title?: string
  /** Quando informado (ex.: 50), compõe a mensagem "limite atual: X moedas". `null`/omitido = mensagem sem número. */
  limitValue?: number | null
  /** Etapa 5.9E — de qual ponto do produto este Paywall foi aberto (propriedade `trigger` de `upgrade_viewed`). */
  trigger: UpgradeViewedTrigger
  /** Etapa 5.9E — plano ATUAL do usuário, resolvido pelo caller a partir de uma fonte de entitlement real (nunca decidido aqui). Usado só em `upgrade_viewed` — nunca confundir com `targetPlanSlug`. */
  planSlug: string
  /** Etapa 5.9E — contagem atual, só quando o trigger é de limite de coleção (`collection_limit`/`restore_limit`); omitido nos demais. */
  currentCount?: number
  /** Etapa 5.10D — plano sendo COMPRADO (nunca o atual) — vai literalmente no request de Checkout. */
  targetPlanSlug: PaidPlanSlug
  /** Etapa 5.10D — resolvido pelo caller (mesmo padrão de `targetPlanSlug`). */
  interval: PriceInterval
  /** Etapa 5.10D — resolvido pelo caller via `resolveCurrencyFromCountryCode(profile.countryCode)` — nunca geolocalização, nunca escolhido pelo usuário neste componente. */
  currency: PriceCurrency
}

const DEFAULT_TITLE = 'Desbloqueie o plano Pro'

export function UpgradeToProDialog({
  isOpen,
  onClose,
  title,
  limitValue,
  trigger,
  planSlug,
  currentCount,
  targetPlanSlug,
  interval,
  currency,
}: UpgradeToProDialogProps) {
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Etapa 5.10S — estado do sinal "Quero ser avisado", inteiramente
  // separado do estado de Checkout acima (nunca compartilha isRedirecting/
  // error — são duas ações independentes no mesmo diálogo).
  const [hasInterest, setHasInterest] = useState(false)
  const [isCheckingInterest, setIsCheckingInterest] = useState(false)
  const [isRegisteringInterest, setIsRegisteringInterest] = useState(false)
  const [interestError, setInterestError] = useState<string | null>(null)

  // Etapa 5.9E — "uma abertura real = um evento": o ref só reseta quando
  // `isOpen` volta a `false`, então um re-render com `isOpen` continuando
  // `true` (ou o duplo-mount do StrictMode) nunca dispara de novo; fechar e
  // reabrir é uma nova intenção legítima do usuário, então dispara de novo.
  const upgradeViewedFiredRef = useRef(false)
  useEffect(() => {
    if (!isOpen) {
      upgradeViewedFiredRef.current = false
      return
    }
    if (upgradeViewedFiredRef.current) return
    upgradeViewedFiredRef.current = true

    try {
      trackUpgradeViewed({
        trigger,
        plan_slug: planSlug,
        current_count: currentCount,
        limit: limitValue ?? undefined,
      })
    } catch (err) {
      Sentry.captureException(err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a transição de isOpen deve redisparar; trigger/planSlug/currentCount/limitValue não mudam com o dialog já aberto.
  }, [isOpen])

  // Etapa 5.10S — item 4: "se já houver interesse registrado quando o
  // diálogo abrir, mostrar imediatamente o estado registrado". Reseta ao
  // fechar (nunca vaza estado de uma abertura anterior, ex.: Pro depois
  // Premium, para a próxima abertura). `cancelled` evita setState após
  // fechar/desmontar (mesmo problema clássico de efeito assíncrono).
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional ao fechar: sincroniza o estado local com o ciclo de vida do dialog (mesmo padrão de upgradeViewedFiredRef acima, aqui em state em vez de ref porque afeta o texto/disabled renderizado do botão) — nunca dispara cascata visível, pois o Modal não renderiza conteúdo com isOpen=false.
      setHasInterest(false)
      setInterestError(null)
      setIsCheckingInterest(false)
      return
    }

    let cancelled = false
    setIsCheckingInterest(true)

    planInterestRepository
      .getStatus(targetPlanSlug)
      .then((status) => {
        if (!cancelled) setHasInterest(status.registered)
      })
      .catch((err) => {
        Sentry.captureException(err)
      })
      .finally(() => {
        if (!cancelled) setIsCheckingInterest(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, targetPlanSlug])

  async function handleRegisterInterest() {
    // Idempotência também no client: um clique enquanto já registrado ou
    // já em voo nunca dispara um segundo INSERT (a UNIQUE do banco já
    // garante o mesmo no limite, mas evitamos a chamada de rede à toa).
    if (hasInterest || isRegisteringInterest) return

    setInterestError(null)
    setIsRegisteringInterest(true)

    try {
      // Nunca chama /api/billing/checkout, nunca toca Stripe — só grava em
      // plan_interest. targetPlanSlug é o plano efetivamente apresentado
      // neste diálogo (nunca hardcoded); trigger é a mesma origem já usada
      // por upgrade_viewed/checkout_started, reaproveitada como source.
      await planInterestRepository.register({ planSlug: targetPlanSlug, source: trigger })
      setHasInterest(true)

      try {
        trackUpgradeInterestRegistered({ trigger, plan_slug: targetPlanSlug, currency })
      } catch (err) {
        Sentry.captureException(err)
      }
    } catch (err) {
      // Etapa 5.10S — item "erro de banco NÃO dispara o evento": o catch
      // deste bloco externo nunca chama trackUpgradeInterestRegistered.
      Sentry.captureException(err)
      setInterestError('Não foi possível registrar seu interesse agora. Tente novamente.')
    } finally {
      setIsRegisteringInterest(false)
    }
  }

  async function handleUpgrade() {
    setError(null)
    setIsRedirecting(true)

    try {
      // Etapa "5.9G — First-Party Analytics Outbox" — o ÚNICO dado de
      // analytics que este endpoint aceita do cliente (nunca metadata
      // arbitrário). Isolado em seu próprio try/catch: uma falha ao ler
      // consentimento NUNCA pode impedir o upgrade real (fail-safe) — cai
      // para `false` (fail-closed), nunca assume `true` silenciosamente.
      let analyticsConsent = false
      try {
        analyticsConsent = getConsent().analytics
      } catch (err) {
        Sentry.captureException(err)
      }

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug: targetPlanSlug, interval, currency, analyticsConsent }),
      })
      const body: { url?: string; funnelId?: string; error?: string } | null = await response.json().catch(() => null)

      if (!response.ok || !body?.url) {
        setError(body?.error ?? 'Não foi possível iniciar o upgrade agora. Tente novamente.')
        setIsRedirecting(false)
        return
      }

      // Etapa 5.9E/5.9G — só dispara DEPOIS de confirmar sucesso + url
      // válida acima; propriedades vêm dos mesmos literais já enviados no
      // body da requisição + `funnelId` devolvido pela resposta (nunca o
      // `sessionId` também presente na resposta — o Stripe Checkout
      // Session ID nunca é usado por analytics no lado do cliente).
      // `pushToDataLayer` já é no-op sem `consent.analytics` — não
      // duplicamos essa checagem aqui.
      if (body.funnelId) {
        try {
          trackCheckoutStarted({ plan_slug: targetPlanSlug, interval, currency, funnel_id: body.funnelId })
        } catch (err) {
          Sentry.captureException(err)
        }
      }

      window.location.href = body.url
    } catch {
      setError('Não foi possível iniciar o upgrade agora. Tente novamente.')
      setIsRedirecting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (isRedirecting) return
        onClose()
      }}
      title={title ?? DEFAULT_TITLE}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={handleRegisterInterest}
            isLoading={isRegisteringInterest}
            disabled={hasInterest || isCheckingInterest}
            aria-live="polite"
          >
            {hasInterest ? 'Você está na lista de interesse' : 'Quero ser avisado'}
          </Button>
          <Button type="button" onClick={handleUpgrade} isLoading={isRedirecting}>
            <Sparkles className="size-4" aria-hidden />
            Fazer upgrade para Pro
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-text-secondary">
        {typeof limitValue === 'number' && (
          <p>
            O plano Free permite até <span className="font-medium text-text-primary">{limitValue} moedas</span> ativas na
            coleção.
          </p>
        )}
        <p>Sua coleção continua intacta — nada é apagado ou escondido.</p>
        <p>O plano Pro remove esse limite e libera o Dashboard avançado.</p>
        <p className="text-xs">
          Durante o Beta, “Quero ser avisado” não cobra nada agora e não abre o Checkout — só registra seu interesse
          para quando o plano estiver disponível para contratação.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        {interestError && <p className="text-sm text-danger">{interestError}</p>}
      </div>
    </Modal>
  )
}
