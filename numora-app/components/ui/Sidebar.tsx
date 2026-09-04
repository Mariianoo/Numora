/**
 * components/ui/Sidebar.tsx
 * Navegação lateral autenticada. Mostra somente rotas que existem de
 * verdade — sem links quebrados/desabilitados para funcionalidades
 * futuras (Wishlist, Compras, Vendas, Configurações). A lista
 * `MAIN_NAV` é o único lugar a estender quando essas rotas existirem.
 *
 * Seção "Administração" (Etapa 15.5): só renderiza para `role` 'owner'/
 * 'admin' — puramente cosmética, o link em si aponta para `/admin`, que
 * segue protegido no servidor por `requireAdmin()` independentemente de
 * este item aparecer ou não aqui.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Coins, UserRound, Shield, Compass } from 'lucide-react'

import { LogoutButton } from '@/features/auth/components/LogoutButton'
import type { AdminRole } from '@/features/admin/types'
import { NumoraLogo } from './NumoraLogo'
import { cn } from './utils'

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
}

const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/collection', label: 'Minha Coleção', icon: Coins },
  { href: '/dashboard/profile', label: 'Meu Perfil', icon: UserRound },
  { href: '/explore', label: 'Explorar', icon: Compass },
]

const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Painel Administrativo', icon: Shield }

const ADMIN_ACCESS_ROLES: readonly AdminRole[] = ['owner', 'admin']

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        isActive
          ? 'bg-accent/10 text-accent'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
    </Link>
  )
}

export interface SidebarProps {
  isMobileOpen: boolean
  onClose: () => void
  /** `null`/`undefined` = ainda não carregada ou sem privilégio — nunca mostra a seção "Administração". */
  role?: AdminRole | null
}

export function Sidebar({ isMobileOpen, onClose, role }: SidebarProps) {
  const pathname = usePathname()
  const showAdminSection = role != null && ADMIN_ACCESS_ROLES.includes(role)

  const content = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-2 pt-2">
        <NumoraLogo variant="mark" size={32} />
        <span className="text-lg font-semibold tracking-wide text-text-primary">NUMORA</span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <p className="px-3 text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
          Principal
        </p>
        <nav className="flex flex-col gap-1">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        {showAdminSection && (
          <>
            <p className="mt-4 px-3 text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
              Administração
            </p>
            <nav className="flex flex-col gap-1">
              <NavLink item={ADMIN_NAV_ITEM} pathname={pathname} />
            </nav>
          </>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <LogoutButton />
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:flex">{content}</aside>

      {/* Mobile drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface shadow-2xl">
            {content}
          </aside>
        </div>
      )}
    </>
  )
}
