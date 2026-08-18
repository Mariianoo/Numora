/**
 * components/analytics/AttributionCapture.tsx
 * Etapa 15.10.2 — monta uma vez no layout raiz (mesmo padrão de
 * `GoogleTagManager.tsx`), nunca renderiza nada visível. Só chama
 * `captureAttribution()` quando `consent.marketing === true` — reage a
 * mudanças de consentimento (`useConsent()`), então se o usuário conceder
 * consentimento DEPOIS de já estar no site, a captura roda no primeiro
 * momento em que isso se torna verdade (ainda respeitando "nunca
 * sobrescreve" dentro de `captureAttribution()`).
 *
 * Isolado e fácil de remover — igual ao GTM: apagar este arquivo + a
 * linha que o monta em app/layout.tsx é suficiente para desligar a
 * captura de atribuição por completo.
 */
'use client'

import { useEffect } from 'react'

import { useConsent } from '@/lib/analytics/consent'
import { captureAttribution } from '@/lib/analytics/attribution'

export function AttributionCapture() {
  const { marketing } = useConsent()

  useEffect(() => {
    if (marketing) {
      captureAttribution()
    }
  }, [marketing])

  return null
}
