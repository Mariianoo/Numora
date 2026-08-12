/**
 * app/dashboard/page.tsx
 * Página protegida (sem estilização avançada). O middleware já bloqueia
 * acesso sem sessão, mas a página também verifica a sessão via supabase
 * server client — segunda camada de defesa, não depende só do middleware.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/features/auth/components/LogoutButton'

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p>Dashboard</p>
        <LogoutButton />
      </div>
      <p>Logado como: {user.email}</p>
      <p>
        <Link href="/dashboard/collection">Minha Coleção</Link>
      </p>
    </div>
  )
}
