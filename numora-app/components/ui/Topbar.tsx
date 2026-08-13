/**
 * components/ui/Topbar.tsx
 * Barra superior persistente — contexto da página + identidade do
 * usuário. O botão de menu (drawer da Sidebar) só aparece abaixo de md.
 * `userLabel` vem de `authRepository.getSession()` (já existente, sem
 * chamada Supabase nova) — ver app/dashboard/layout.tsx.
 */
'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'

import { Avatar } from './Avatar'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/collection': 'Minha Coleção',
}

export interface TopbarProps {
  onMenuClick: () => void
  userLabel: string | null
}

export function Topbar({ onMenuClick, userLabel }: TopbarProps) {
  const pathname = usePathname()
  const pageTitle = PAGE_TITLES[pathname] ?? ''

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu"
        className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {/* Mobile: a marca fica visível aqui, já que a Sidebar (onde ela mora no desktop) está oculta */}
      <span className="text-base font-semibold tracking-wide text-text-primary md:hidden">
        NUMORA<span className="text-accent">.</span>
      </span>

      <p className="hidden flex-1 truncate text-sm font-medium text-text-secondary md:block">{pageTitle}</p>
      <div className="flex-1 md:hidden" />

      {userLabel && (
        <div className="flex items-center gap-2.5">
          <Avatar name={userLabel} size="sm" />
          <span className="hidden max-w-[10rem] truncate text-sm text-text-secondary sm:inline">
            {userLabel}
          </span>
        </div>
      )}
    </header>
  )
}
