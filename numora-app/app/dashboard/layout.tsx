/**
 * app/dashboard/layout.tsx
 * Shell autenticado (Sidebar + Topbar) compartilhado por todas as rotas
 * /dashboard/*. A guarda de sessão continua em proxy.ts (presença de
 * cookie) e em cada Server Component (getUser() real) — este layout é
 * puramente visual/estrutural, não decide autenticação.
 *
 * `userLabel` (Topbar) vem de `authRepository.getSession()` — mesmo
 * método já usado em app/login/page.tsx, client-side, sem chamada
 * Supabase nova (sessão já fica em cache local após o login).
 *
 * `role` (Etapa 15.5): vem de `adminRepository.getOwnRole()` — só decide o
 * que é MOSTRADO (item "Painel Administrativo" na Sidebar, badge na
 * Topbar). Puramente cosmético: a proteção real de `/admin/*` continua
 * inteiramente em `requireAdmin()` (`app/admin/layout.tsx`, servidor) +
 * `is_platform_admin()` (banco) — nenhuma delas depende deste valor.
 */
'use client'

import { useEffect, useState } from 'react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { createSupabaseAdminRepository } from '@/features/admin/repositories/admin.repository'
import type { AdminRole } from '@/features/admin/types'
import { Sidebar } from '@/components/ui/Sidebar'
import { Topbar } from '@/components/ui/Topbar'

const authRepository = createSupabaseAuthRepository()
const adminRepository = createSupabaseAdminRepository()

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [userLabel, setUserLabel] = useState<string | null>(null)
  const [role, setRole] = useState<AdminRole | null>(null)

  useEffect(() => {
    authRepository.getSession().then((session) => {
      setUserLabel(session?.user.email ?? null)
    })
    adminRepository
      .getOwnRole()
      .then(setRole)
      .catch(() => setRole(null))
  }, [])

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar isMobileOpen={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setIsMobileNavOpen(true)} userLabel={userLabel} role={role} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
