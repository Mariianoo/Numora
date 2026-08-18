/**
 * components/analytics/LandingViewTracker.tsx
 * Etapa 15.10.4 — mesmo padrão de `GoogleTagManager.tsx`/`AttributionCapture.tsx`:
 * componente client isolado, zero props, nunca renderiza nada visível, monta
 * dentro de uma página Server Component (`app/page.tsx`) sem convertê-la.
 * Dispara `landing_view` uma vez, no mount — `trackLandingView()` já é
 * no-op sem `consent.analytics` (gate central em `lib/analytics/gtm.ts`).
 *
 * `firedRef` evita disparo duplicado sob React StrictMode (dev): o
 * ambiente de desenvolvimento do Next.js monta/desmonta/remonta efeitos de
 * propósito para detectar side effects não-idempotentes — sem essa
 * guarda, `landing_view` apareceria 2x no dataLayer em `next dev` (nunca
 * em produção, onde StrictMode não dobra efeitos, mas a guarda deixa o
 * comportamento idêntico nos dois ambientes, sem depender disso).
 */
'use client'

import { useEffect, useRef } from 'react'

import { trackLandingView } from '@/lib/analytics/events/product-events'

export function LandingViewTracker() {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    trackLandingView()
  }, [])

  return null
}
