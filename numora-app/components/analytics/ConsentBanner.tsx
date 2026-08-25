/**
 * components/analytics/ConsentBanner.tsx
 * Etapa 15.10.8 — CMP mínimo. Aparece só quando nenhuma decisão de
 * consentimento foi salva ainda.
 *
 * `ConsentState` ({analytics,marketing}, lib/analytics/consent.ts) não
 * distingue "nunca decidiu" de "decidiu recusar tudo" — as duas situações
 * viram `{false,false}`. Por isso este componente lê
 * `localStorage['numora_consent']` DIRETAMENTE (não via `getConsent()`),
 * só para essa checagem pontual de presença — achado registrado na
 * auditoria da etapa, resolvido sem alterar `lib/analytics/consent.ts`
 * (fora do escopo aprovado). Toda leitura/escrita real de consentimento
 * continua exclusivamente via `getConsent()`/`setConsent()`.
 *
 * "Aceitar todos"/"Recusar todos" nunca são revogação (não existia decisão
 * anterior nesta tela) — nunca recarregam a página. `GoogleTagManager`/
 * `AttributionCapture` já reagem sozinhos via `useConsent()` (não
 * alterados nesta etapa). "Gerenciar preferências" abre
 * `ConsentPreferencesModal` (que trata revogação por conta própria, se o
 * usuário abrir e desmarcar algo já concedido antes).
 *
 * Montado uma única vez em `app/layout.tsx`, mesmo padrão de
 * `GoogleTagManager`/`AttributionCapture` — nunca deve ser montado em
 * nenhum outro layout.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { setConsent } from '@/lib/analytics/consent'
import { Button } from '@/components/ui/Button'
import { ConsentPreferencesModal } from './ConsentPreferencesModal'

const STORAGE_KEY = 'numora_consent'

export function ConsentBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false)

  useEffect(() => {
    Promise.resolve().then(() => {
      if (window.localStorage.getItem(STORAGE_KEY) === null) {
        setShowBanner(true)
      }
    })
  }, [])

  function handleAcceptAll() {
    setConsent({ analytics: true, marketing: true })
    setShowBanner(false)
  }

  function handleRejectAll() {
    setConsent({ analytics: false, marketing: false })
    setShowBanner(false)
  }

  return (
    <>
      {showBanner && (
        <div
          role="region"
          aria-label="Preferências de cookies"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-4 shadow-2xl sm:p-6"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Usamos cookies para entender como o Numora é usado e de onde vêm os cadastros. Você decide o que
              aceitar — nada é ativado sem sua permissão.{' '}
              <Link href="/cookies" className="underline underline-offset-2 hover:text-accent">
                Saiba mais
              </Link>
              .
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsPreferencesOpen(true)}>
                Gerenciar preferências
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={handleRejectAll}>
                Recusar todos
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={handleAcceptAll}>
                Aceitar todos
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConsentPreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        onSaved={() => setShowBanner(false)}
      />
    </>
  )
}
