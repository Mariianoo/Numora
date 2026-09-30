/**
 * features/auth/use-captcha.ts
 * Etapa "B2.1 — Hardening" — estado do CAPTCHA (Turnstile) compartilhado por
 * login, esqueci-a-senha e cadastro. Uma única implementação: quem usa só
 * renderiza `<TurnstileWidget>` quando `siteKey` existe e chama `consume()`
 * no envio.
 *
 * O token vive SÓ em memória (estado do React): nunca vai a localStorage/
 * sessionStorage/cookie/URL, nunca é registrado em log e nunca é enviado ao
 * Sentry. É de USO ÚNICO — `consume()` o entrega uma vez e já dispara o
 * reset do widget para emitir um novo token na próxima tentativa (sucesso ou
 * falha).
 */
import { useCallback, useState } from 'react'

import { CLIENT_TURNSTILE_SITE_KEY } from '@/lib/captcha/captcha-client'

export const CAPTCHA_REQUIRED_MESSAGE = 'Confirme que você não é um robô e tente novamente.'

export function useCaptcha(siteKey: string | null = CLIENT_TURNSTILE_SITE_KEY) {
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)

  const handleToken = useCallback((next: string | null) => setToken(next), [])

  /** Entrega o token atual (uma única vez) e pede um novo ao widget. */
  const consume = useCallback((): string | null => {
    const current = token
    setToken(null)
    setResetKey((key) => key + 1)
    return current
  }, [token])

  return { siteKey, enabled: siteKey !== null, token, handleToken, resetKey, consume }
}
