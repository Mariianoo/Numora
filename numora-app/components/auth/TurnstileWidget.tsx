/**
 * components/auth/TurnstileWidget.tsx
 * Etapa "B2 — Signup + Legal" — widget do Cloudflare Turnstile, preparado
 * para uso futuro. Só é renderizado por quem recebe uma `siteKey` (a
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, pública por definição); sem site key o
 * chamador simplesmente não o renderiza e nenhum script externo é carregado.
 *
 * Carrega `https://challenges.cloudflare.com/turnstile/v0/api.js` sob
 * demanda (o CSP só libera esse domínio quando a site key existe — ver
 * next.config.ts). O token é entregue via `onToken` e nunca é registrado em
 * log; ele é repassado ao Supabase Auth (`captchaToken`), que faz a
 * verificação — não há secret do Turnstile no código.
 */
'use client'

import { useEffect, useRef } from 'react'

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void },
  ) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('turnstile_script_failed')), { once: true })
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })
}

export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey = 0,
}: {
  siteKey: string
  onToken: (token: string | null) => void
  /** Incrementar invalida o token atual (uso único) e pede um novo ao Turnstile. */
  resetKey?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
    }
  }, [resetKey])

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetId = widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        })
      })
      .catch(() => onToken(null))

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
      widgetIdRef.current = null
    }
  }, [siteKey, onToken])

  return <div ref={containerRef} />
}
