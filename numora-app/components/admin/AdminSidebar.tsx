/**
 * components/admin/AdminSidebar.tsx
 * Navegação lateral do Admin Control Center (Etapa 15.3) — componente
 * separado de `components/ui/Sidebar.tsx` de propósito: rotas, público e
 * rótulo de marca são inteiramente diferentes do dashboard do
 * colecionador, e `Sidebar` documenta explicitamente "mostrar somente
 * rotas que existem de verdade" com uma lista própria (`MAIN_NAV`) — bifurcar
 * aqui evita forçar as duas navegações a compartilhar uma lista que não faz
 * sentido para nenhuma das duas. Mesmos tokens/classes visuais do design
 * system (nenhum estilo novo).
 *
 * Rotas com `disabled: true` existem de verdade (arquivo/rota real, gated
 * pela mesma `requireAdmin()`), mas mostram conteúdo "Em breve" — não são
 * links falsos, só ainda sem funcionalidade completa (Etapa 15.3 §4/§16).
 *
 * "Numora Health" (Etapa 15.10.7): único item de `ADMIN_NAV` marcado
 * `ownerOnly` — a barreira REAL continua sendo `app/admin/health/page.tsx`
 * (`requireAdmin()` + `role !== 'owner'` → redirect) e `is_platform_owner()`
 * dentro de `admin_health_snapshot()` (banco); esconder o link para ADMIN
 * aqui é só UX (evita levar a um redirect), reaproveitando `getOwnRole()`
 * — já existente, já usado por `app/dashboard/layout.tsx` para decidir se
 * mostra "Painel Administrativo" — nenhum mecanismo de autorização novo.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Receipt,
  TrendingUp,
  BarChart3,
  Bell,
  ScrollText,
  Settings,
  Activity,
} from 'lucide-react'

import { LogoutButton } from '@/features/auth/components/LogoutButton'
import { createSupabaseAdminRepository } from '@/features/admin/repositories/admin.repository'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/components/ui/utils'

const adminRepository = createSupabaseAdminRepository()

interface AdminNavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  /** Só renderizado quando `getOwnRole() === 'owner'` — ver comentário do arquivo. */
  ownerOnly?: boolean
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/admin/members', label: 'Membros', icon: Users },
  { href: '/admin/health', label: 'Numora Health', icon: Activity, ownerOnly: true },
  { href: '/admin/subscriptions', label: 'Assinaturas', icon: CreditCard },
  { href: '/admin/transactions', label: 'Transações', icon: Receipt },
  { href: '/admin/revenue', label: 'Receita', icon: TrendingUp },
  { href: '/admin/usage', label: 'Utilização', icon: BarChart3 },
  { href: '/admin/alerts', label: 'Alertas', icon: Bell },
  { href: '/admin/audit', label: 'Auditoria', icon: ScrollText },
  { href: '/admin/settings', label: 'Configurações', icon: Settings },
]

function AdminNavLink({ item, pathname }: { item: AdminNavItem; pathname: string }) {
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

export interface AdminSidebarProps {
  isMobileOpen: boolean
  onClose: () => void
}

export function AdminSidebar({ isMobileOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname()
  const [isOwner, setIsOwner] = useState(false)

  useEffect(() => {
    adminRepository.getOwnRole().then((role) => {
      setIsOwner(role === 'owner')
    })
  }, [])

  const visibleNav = ADMIN_NAV.filter((item) => !item.ownerOnly || isOwner)

  const content = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex flex-col gap-1.5 px-2 pt-2">
        <span className="text-lg font-semibold tracking-wide text-text-primary">
          NUMORA<span className="text-accent">.</span>
        </span>
        <Badge tone="accent" className="w-fit">
          Admin Control Center
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <p className="px-3 text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
          Administração
        </p>
        <nav className="flex flex-col gap-1">
          {visibleNav.map((item) => (
            <AdminNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <Link
          href="/dashboard"
          className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          ← Voltar ao Numora
        </Link>
        <LogoutButton />
      </div>
    </div>
  )

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:flex">{content}</aside>

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
