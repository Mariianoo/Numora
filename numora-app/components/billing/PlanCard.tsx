/**
 * components/billing/PlanCard.tsx
 * Etapa "5.10D — Billing Commercial Foundation" — apresentacional puro,
 * sem lógica de negócio própria (nenhuma decisão de preço/moeda/plano
 * acontece aqui — tudo já vem resolvido do caller). Reaproveita `Card`/
 * `Badge`/`Button` do design system, nenhum componente visual novo
 * inventado além da composição.
 */
import Link from 'next/link'
import { Check } from 'lucide-react'

import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/utils'

export interface PlanCardProps {
  name: string
  /** Já formatado (`formatPrice`) — `null` para o plano Free ("Grátis"). */
  priceLabel: string | null
  /** Ex.: "/mês", "/ano" — omitido para o Free. */
  intervalLabel?: string
  benefits: string[]
  isCurrentPlan: boolean
  ctaLabel: string
  onCtaClick?: () => void
  ctaDisabled?: boolean
  /** Destaque visual (ex.: Pro como "mais popular") — nunca decide preço/entitlement, só estilo. */
  highlighted?: boolean
  /** Etapa 5.10D — percentual real do catálogo (`computeYearlySavingsPercent`), só exibido no intervalo anual; `null`/0 = nenhum badge. */
  yearlySavingsPercent?: number | null
  /** Bloco A (Official Launch Foundation) — plano ainda não contratável ("Em breve"): mostra o badge e nunca o rótulo de "plano atual"/checkout; o CTA é sempre o de `plan_interest`, decidido pelo caller. */
  comingSoon?: boolean
  /** Bloco A — texto curto abaixo do botão (ex.: erro ao registrar interesse, ou "Ainda não disponível para contratação"). */
  footnote?: string | null
  /** B1 — CTA que só NAVEGA (ex.: "Informar país" → perfil): renderizado como link, nunca como ação comercial. Ignorado quando o plano já é o atual. */
  ctaHref?: string
}

export function PlanCard({
  name,
  priceLabel,
  intervalLabel,
  benefits,
  isCurrentPlan,
  ctaLabel,
  onCtaClick,
  ctaDisabled,
  highlighted,
  yearlySavingsPercent,
  comingSoon,
  footnote,
  ctaHref,
}: PlanCardProps) {
  return (
    <Card className={cn('flex flex-col gap-4 p-6', highlighted && 'border-accent/50 ring-1 ring-accent/30')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary">{name}</h3>
        <div className="flex items-center gap-1.5">
          {Boolean(yearlySavingsPercent) && <Badge tone="success">Economize ~{yearlySavingsPercent}%</Badge>}
          {highlighted && <Badge tone="accent">Mais popular</Badge>}
          {comingSoon && <Badge tone="neutral">Em breve</Badge>}
        </div>
      </div>

      <div>
        {priceLabel === null ? (
          <p className="text-2xl font-semibold tracking-tight text-text-primary">Grátis</p>
        ) : (
          <p className="text-2xl font-semibold tracking-tight text-text-primary">
            {priceLabel}
            {intervalLabel && <span className="text-sm font-normal text-text-secondary">{intervalLabel}</span>}
          </p>
        )}
      </div>

      <ul className="flex flex-1 flex-col gap-2 text-sm text-text-secondary">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>

      {ctaHref && !isCurrentPlan ? (
        <Link
          href={ctaHref}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-background shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {ctaLabel}
        </Link>
      ) : (
        <Button
          type="button"
          variant={isCurrentPlan ? 'secondary' : 'primary'}
          disabled={isCurrentPlan || ctaDisabled}
          onClick={onCtaClick}
          className="w-full"
        >
          {isCurrentPlan ? 'Plano atual' : ctaLabel}
        </Button>
      )}

      {footnote && <p className="text-xs text-text-secondary">{footnote}</p>}
    </Card>
  )
}
