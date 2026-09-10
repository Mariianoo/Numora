/**
 * app/dashboard/DashboardUpgradeButton.tsx
 * Etapa "5.9D — Paywall UX" — wrapper client mínimo (mesmo motivo de
 * `DashboardErrorState.tsx`: `app/dashboard/page.tsx` é Server Component,
 * não pode ter estado local). Substitui o `<Link href="/dashboard/profile">`
 * provisório da Etapa 5.9C pelo Paywall real — a mesma experiência usada
 * pela Coleção/Lixeira ao atingir o limite de 50 moedas, conforme pedido
 * explicitamente ("consistente com o futuro Paywall da coleção").
 *
 * Etapa "5.9E — Analytics": `planSlug` vem do Server Component pai
 * (`dashboard/page.tsx`, via RPC `get_effective_plan()` — mesma fonte que
 * `ProfileRepository.getOwnEffectivePlan()` usa no client) — nunca
 * resolvido aqui por comparação de string.
 */
'use client'

import { useState } from 'react'

import { UpgradeToProDialog } from '@/components/billing/UpgradeToProDialog'

export interface DashboardUpgradeButtonProps {
  planSlug: string
}

export function DashboardUpgradeButton({ planSlug }: DashboardUpgradeButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
      >
        Fazer upgrade
      </button>
      <UpgradeToProDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Desbloqueie o Dashboard avançado"
        trigger="dashboard"
        planSlug={planSlug}
      />
    </>
  )
}
