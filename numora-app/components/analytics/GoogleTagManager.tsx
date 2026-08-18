/**
 * components/analytics/GoogleTagManager.tsx
 * Etapa 15.10.1 — loader do GTM, isolado e fácil de remover (basta apagar
 * este arquivo + a linha que o monta em app/layout.tsx).
 *
 * Renderiza `null` (nenhum script, nenhum request) quando:
 * - `NEXT_PUBLIC_GTM_ID` não está configurado (nunca inventado/hardcoded —
 *   auditoria da Etapa 15.10 §"REGRA 1/2"); ou
 * - o formato não bate com `GTM-XXXXXXX` (defesa contra erro de digitação
 *   na env var, não é uma checagem de segurança); ou
 * - `consent.analytics` ainda é `false` (default até um futuro CMP chamar
 *   `setConsent({ analytics: true })`, ver lib/analytics/consent.ts).
 *
 * Isso responde literalmente ao teste #2 da Etapa 15.10.1: "GTM
 * configurado → script aparece somente quando permitido pelo
 * consentimento" — o script só entra no DOM quando as duas condições
 * (ID válido + consentimento) são verdadeiras, nunca antes.
 *
 * `strategy="afterInteractive"` (next/script): carrega depois da página
 * ficar interativa, nunca bloqueia o primeiro paint/LCP — mesma
 * recomendação da auditoria (Etapa 15.10 §13).
 *
 * O snippet abaixo é o loader oficial do Google Tag Manager (idêntico ao
 * fornecido pelo próprio GTM), só parametrizado por `gtmId` — nenhuma
 * lógica própria de terceiros, nenhuma dependência nova instalada.
 */
'use client'

import Script from 'next/script'

import { clientEnv } from '@/lib/env.server'
import { useConsent } from '@/lib/analytics/consent'

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/

export function GoogleTagManager() {
  const gtmId = clientEnv.NEXT_PUBLIC_GTM_ID
  const { analytics } = useConsent()

  if (!gtmId || !GTM_ID_PATTERN.test(gtmId) || !analytics) {
    return null
  }

  return (
    <Script id="gtm-loader" strategy="afterInteractive">
      {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
    </Script>
  )
}
