/**
 * app/dashboard/DashboardErrorState.tsx
 * Wrapper client mínimo (Etapa 12.4) — `app/dashboard/page.tsx` é Server
 * Component (não pode segurar um closure de retry), então este arquivo
 * existe só para dar ao `ErrorState` uma ação de "Tentar novamente" real:
 * `router.refresh()` re-executa o Server Component no servidor com as
 * mesmas queries. Não é uma variante nova de `ErrorState` — a API do
 * componente continua exatamente a mesma, isto só resolve a fronteira
 * servidor/cliente do Next.js.
 */
'use client'

import { useRouter } from 'next/navigation'

import { ErrorState } from '@/components/ui/ErrorState'

export interface DashboardErrorStateProps {
  title: string
  description?: string
}

export function DashboardErrorState({ title, description }: DashboardErrorStateProps) {
  const router = useRouter()

  return (
    <ErrorState
      title={title}
      description={description}
      actionLabel="Tentar novamente"
      onAction={() => {
        router.refresh()
      }}
    />
  )
}
