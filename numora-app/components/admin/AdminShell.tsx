/**
 * components/admin/AdminShell.tsx
 * Shell visual do Admin Control Center — mesmo papel de
 * `app/dashboard/layout.tsx` (Sidebar + Topbar + estado do drawer mobile),
 * só que para `/admin/*`. Componente `'use client'` separado do
 * `app/admin/layout.tsx` (Server Component) porque a guarda de autorização
 * (`requireAdmin()`) precisa rodar no servidor, mas o estado do menu mobile
 * precisa de client — mesma separação já usada no dashboard do
 * colecionador.
 */
'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { AdminSidebar, ADMIN_NAV } from './AdminSidebar'
import { Topbar } from '@/components/ui/Topbar'

const authRepository = createSupabaseAuthRepository()

const ADMIN_PAGE_TITLES: Record<string, string> = Object.fromEntries(
  ADMIN_NAV.map((item) => [item.href, item.label]),
)

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [userLabel, setUserLabel] = useState<string | null>(null)

  useEffect(() => {
    authRepository.getSession().then((session) => {
      setUserLabel(session?.user.email ?? null)
    })
  }, [])

  return (
    <div className="flex min-h-full flex-1">
      <AdminSidebar isMobileOpen={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenuClick={() => setIsMobileNavOpen(true)}
          userLabel={userLabel}
          title={ADMIN_PAGE_TITLES[pathname] ?? 'Admin Control Center'}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
