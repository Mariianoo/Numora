/**
 * components/ui/Topbar.tsx
 * Barra superior persistente — contexto da página + identidade do
 * usuário. O botão de menu (drawer da Sidebar) só aparece abaixo de md.
 * `userLabel` vem de `authRepository.getSession()` (já existente, sem
 * chamada Supabase nova) — ver app/dashboard/layout.tsx.
 *
 * `role` (Etapa 15.5): selo discreto "OWNER"/"ADMIN" ao lado do nome —
 * some no mesmo breakpoint que o nome (abaixo de sm) para não competir por
 * espaço nem aparecer "solto" sem o nome ao lado. Puramente informativo,
 * nenhuma decisão de acesso depende deste componente.
 */
'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'

import { Avatar } from './Avatar'
import { Badge } from './Badge'
import { IconButton } from './IconButton'
import { NumoraLogo } from './NumoraLogo'
import type { AdminRole } from '@/features/admin/types'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/collection': 'Minha Coleção',
  '/dashboard/profile': 'Meu Perfil',
}

const ROLE_BADGE_LABEL: Partial<Record<AdminRole, string>> = {
  owner: 'OWNER',
  admin: 'ADMIN',
}

export interface TopbarProps {
  onMenuClick: () => void
  userLabel: string | null
  /** Etapa 15.3: sobrepõe o lookup por `PAGE_TITLES` — usado pelo Admin Control Center, cujas rotas não existem nesse mapa. Omitido = comportamento de sempre. */
  title?: string
  /** Etapa 15.5: exibe o selo "OWNER"/"ADMIN" quando aplicável. `null`/`undefined` = nenhum selo. */
  role?: AdminRole | null
}

export function Topbar({ onMenuClick, userLabel, title, role }: TopbarProps) {
  const pathname = usePathname()
  const pageTitle = title ?? PAGE_TITLES[pathname] ?? ''
  const roleBadgeLabel = role != null ? ROLE_BADGE_LABEL[role] : undefined

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <IconButton icon={Menu} onClick={onMenuClick} aria-label="Abrir menu" className="md:hidden" />

      {/* Mobile: a marca fica visível aqui, já que a Sidebar (onde ela mora no desktop) está oculta */}
      <NumoraLogo variant="full" theme="dark" size={20} className="md:hidden" />

      <p className="hidden flex-1 truncate text-sm font-medium text-text-secondary md:block">{pageTitle}</p>
      <div className="flex-1 md:hidden" />

      {userLabel && (
        <div className="flex items-center gap-2.5">
          <Avatar name={userLabel} size="sm" />
          <span className="hidden max-w-[10rem] truncate text-sm text-text-secondary sm:inline">
            {userLabel}
          </span>
          {roleBadgeLabel && (
            <Badge tone="accent" className="hidden shrink-0 px-1.5 py-0 text-[10px] tracking-wider sm:inline-flex">
              {roleBadgeLabel}
            </Badge>
          )}
        </div>
      )}
    </header>
  )
}
