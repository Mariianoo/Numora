/**
 * components/admin/AdminComingSoon.tsx
 * Placeholder honesto para rotas administrativas que já existem de
 * verdade (gated por `requireAdmin()`, ver `app/admin/layout.tsx`) mas
 * ainda sem funcionalidade — Etapa 15.3 §4 permite explicitamente isso
 * ("Em breve", desde que não seja rota falsa). Nunca mostra dado
 * inventado; só comunica o que está por vir.
 */
import type { LucideIcon } from 'lucide-react'

import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

export interface AdminComingSoonProps {
  title: string
  pageDescription: string
  icon: LucideIcon
  emptyDescription: string
}

export function AdminComingSoon({ title, pageDescription, icon, emptyDescription }: AdminComingSoonProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={pageDescription} />
      <EmptyState icon={icon} title="Em breve" description={emptyDescription} />
    </div>
  )
}
