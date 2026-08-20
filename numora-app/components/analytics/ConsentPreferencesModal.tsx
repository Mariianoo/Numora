/**
 * components/analytics/ConsentPreferencesModal.tsx
 * Etapa 15.10.8 — toggles independentes de `analytics`/`marketing`,
 * reaproveita `components/ui/Modal.tsx` (sem overlay novo, sem sistema de
 * estado global). Usado em dois pontos sem duplicação: dentro de
 * `ConsentBanner.tsx` (1ª visita, via "Gerenciar preferências") e em
 * `app/dashboard/profile/page.tsx` (alteração posterior).
 *
 * Lê/escreve consentimento exclusivamente via `getConsent()`/`setConsent()`
 * (lib/analytics/consent.ts, não alterado nesta etapa) — este componente
 * não guarda nenhuma verdade própria, só espelha o estado real em toggles
 * locais enquanto o modal está aberto.
 *
 * Regra de revogação (achado da auditoria da etapa): se `analytics` ou
 * `marketing` passar de `true` para `false`, a página é recarregada
 * (`window.location.reload()`) depois de salvar — garante que nenhum
 * script de terceiro já carregado (GTM) continue ativo numa sessão que
 * começou antes da revogação. Solução deliberadamente simples, aprovada
 * explicitamente para esta primeira versão — não é Consent Mode, não é
 * integração nova. Quando nada foi revogado (1ª decisão, ou só concessões
 * novas), fecha o modal normalmente: `GoogleTagManager`/`AttributionCapture`
 * já reagem sozinhos via `useConsent()`, sem precisar de reload.
 */
'use client'

import { useEffect, useState } from 'react'

import { getConsent, setConsent } from '@/lib/analytics/consent'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/utils'

export interface ConsentPreferencesModalProps {
  isOpen: boolean
  onClose: () => void
  /** Chamado só quando o usuário efetivamente salva uma decisão — nunca em cancelar/Escape/X. */
  onSaved?: () => void
}

function ConsentToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          checked ? 'bg-accent' : 'bg-surface-hover',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-background transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  )
}

export function ConsentPreferencesModal({ isOpen, onClose, onSaved }: ConsentPreferencesModalProps) {
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  // Sempre relê o estado real ao abrir — nunca confia em memória entre
  // aberturas. `Promise.resolve().then()` (não setState direto no corpo
  // do efeito) — mesmo padrão já usado em lib/analytics/consent.ts
  // (useConsent) e nas páginas de coleção/perfil: react-hooks/set-state-in-effect
  // só reconhece que o setState não é síncrono quando fica dentro de um
  // callback `.then()`.
  useEffect(() => {
    if (!isOpen) return
    Promise.resolve().then(() => {
      const current = getConsent()
      setAnalytics(current.analytics)
      setMarketing(current.marketing)
    })
  }, [isOpen])

  function handleSave() {
    const previous = getConsent()
    const isRevocation = (previous.analytics && !analytics) || (previous.marketing && !marketing)

    setConsent({ analytics, marketing })

    if (isRevocation) {
      window.location.reload()
      return
    }

    onSaved?.()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Preferências de privacidade"
      description="Escolha o que o Numora pode usar. Você pode mudar isso quando quiser."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleSave}>
            Salvar preferências
          </Button>
        </>
      }
    >
      <div className="flex flex-col divide-y divide-border">
        <ConsentToggle
          label="Analytics"
          description="Ajuda a entender como o Numora é usado (Google Analytics/Tag Manager)."
          checked={analytics}
          onChange={setAnalytics}
        />
        <ConsentToggle
          label="Marketing"
          description="Identifica de onde veio seu cadastro (origem/campanha), para medir divulgação."
          checked={marketing}
          onChange={setMarketing}
        />
      </div>
    </Modal>
  )
}
