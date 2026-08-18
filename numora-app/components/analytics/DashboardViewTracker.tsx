/**
 * components/analytics/DashboardViewTracker.tsx
 * Etapa 15.10.4 — mesmo padrão de `LandingViewTracker.tsx`: componente
 * client isolado, zero props, monta dentro de `app/dashboard/page.tsx`
 * (Server Component) sem convertê-la. Dispara `dashboard_view` uma vez,
 * no mount. `firedRef` evita duplicação sob React StrictMode (dev) — ver
 * comentário equivalente em `LandingViewTracker.tsx`.
 */
'use client'

import { useEffect, useRef } from 'react'

import { trackDashboardView } from '@/lib/analytics/events/product-events'

export function DashboardViewTracker() {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    trackDashboardView()
  }, [])

  return null
}
