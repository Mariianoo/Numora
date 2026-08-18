/**
 * lib/analytics/consent.ts
 * Etapa 15.10.1 — estado mínimo de consentimento, client-side, sem CMP.
 *
 * Duas categorias SEPARADAS desde já (`analytics`/`marketing`), mesmo que
 * hoje só `analytics` tenha um consumidor real (`GoogleTagManager.tsx`) —
 * pedido explícito da Etapa 15.10.1: preparar a separação para quando um
 * banner de consentimento (fora do escopo desta etapa) existir. Nenhuma
 * das duas está ligada a autorização/entitlement/plano — é só um
 * interruptor para carregar (ou não) scripts de terceiros.
 *
 * Default `{ analytics: false, marketing: false }` (opt-in, nunca
 * opt-out) — sem nenhuma UI de banner ainda, `setConsent()` é a API que um
 * futuro CMP chamaria a partir do clique em "Aceitar". Persistido em
 * `localStorage` (não cookie): decisão puramente client-side, nenhuma
 * página hoje precisa saber o consentimento durante SSR.
 */
'use client'

import { useEffect, useState } from 'react'

export interface ConsentState {
  analytics: boolean
  marketing: boolean
}

const STORAGE_KEY = 'numora_consent'
const CONSENT_CHANGE_EVENT = 'numora:consent-change'

const DEFAULT_CONSENT: ConsentState = { analytics: false, marketing: false }

function readStoredConsent(): ConsentState {
  if (typeof window === 'undefined') return DEFAULT_CONSENT

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONSENT

    const parsed = JSON.parse(raw) as Partial<ConsentState>
    return {
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
    }
  } catch {
    return DEFAULT_CONSENT
  }
}

export function getConsent(): ConsentState {
  return readStoredConsent()
}

/**
 * API pública para um futuro banner de consentimento chamar. Faz merge
 * parcial (permite atualizar só `analytics` sem mexer em `marketing`, e
 * vice-versa) e notifica quem estiver usando `useConsent()` na mesma aba
 * via `CustomEvent` (localStorage sozinho só dispara o evento `storage`
 * em OUTRAS abas, nunca na aba que fez a escrita).
 */
export function setConsent(update: Partial<ConsentState>): void {
  if (typeof window === 'undefined') return

  const next: ConsentState = { ...readStoredConsent(), ...update }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_CHANGE_EVENT, { detail: next }))
}

/**
 * Hook client-only — sincroniza entre componentes na mesma aba
 * (CustomEvent) e entre abas (evento nativo `storage`).
 *
 * Leitura inicial encadeada em `Promise.resolve().then(...)` (não
 * `setConsentState()` direto no corpo do efeito) — mesmo padrão já usado
 * em `app/dashboard/collection/page.tsx`/`app/dashboard/profile/page.tsx`:
 * `react-hooks/set-state-in-effect` só reconhece que o `setState` não é
 * síncrono dentro do efeito quando fica dentro de um callback `.then()`.
 */
export function useConsent(): ConsentState {
  const [consent, setConsentState] = useState<ConsentState>(DEFAULT_CONSENT)

  useEffect(() => {
    Promise.resolve().then(() => setConsentState(readStoredConsent()))

    function handleChange() {
      setConsentState(readStoredConsent())
    }

    window.addEventListener(CONSENT_CHANGE_EVENT, handleChange)
    window.addEventListener('storage', handleChange)

    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, handleChange)
      window.removeEventListener('storage', handleChange)
    }
  }, [])

  return consent
}
