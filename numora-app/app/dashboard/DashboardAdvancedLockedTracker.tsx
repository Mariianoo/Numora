/**
 * app/dashboard/DashboardAdvancedLockedTracker.tsx
 * Etapa "5.9E — Analytics" — dispara `feature_locked` (feature_key/context
 * `dashboard_advanced`) uma única vez por carregamento da página, quando o
 * Server Component pai (`dashboard/page.tsx`) determina que as seções
 * avançadas estão bloqueadas E de fato ficariam visíveis nesta renderização
 * (mesma condição usada por `sectionsVisible` no pai — nunca dispara para
 * um usuário novo sem coleção, que nunca chega a ver o cartão bloqueado).
 *
 * Componente único e de nível superior (renderizado uma vez, ao lado de
 * `DashboardViewTracker`) — não embutido dentro de `DashboardAdvancedLockedState`,
 * que é chamado 2x na mesma página (Distribuição + Histórico): embuti-lo lá
 * disparia o evento 2x para o mesmo bloqueio de entitlement, inflando o
 * funil por um mesmo momento do usuário.
 */
'use client'

import { useEffect, useRef } from 'react'
import * as Sentry from '@sentry/nextjs'

import { trackFeatureLocked } from '@/lib/analytics/events/paywall-events'

export interface DashboardAdvancedLockedTrackerProps {
  planSlug: string
}

export function DashboardAdvancedLockedTracker({ planSlug }: DashboardAdvancedLockedTrackerProps) {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true

    try {
      trackFeatureLocked({ feature_key: 'dashboard_advanced', plan_slug: planSlug, context: 'dashboard_advanced' })
    } catch (err) {
      Sentry.captureException(err)
    }
  }, [planSlug])

  return null
}
