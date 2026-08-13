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
 */
'use client'

import { useEffect, useState } from 'react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { Sidebar } from '@/components/ui/Sidebar'
import { Topbar } from '@/components/ui/Topbar'

const authRepository = createSupabaseAuthRepository()

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [userLabel, setUserLabel] = useState<string | null>(null)

  useEffect(() => {
    authRepository.getSession().then((session) => {
      setUserLabel(session?.user.email ?? null)
    })
  }, [])

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar isMobileOpen={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setIsMobileNavOpen(true)} userLabel={userLabel} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
