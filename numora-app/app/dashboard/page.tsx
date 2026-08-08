/**
 * app/dashboard/page.tsx
 * Página protegida (sem estilização avançada). O middleware já bloqueia
 * acesso sem sessão, mas a página também verifica a sessão via supabase
 * server client — segunda camada de defesa, não depende só do middleware.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSupabaseServerClient } from '@/lib/supabase/server'

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
      <p>Dashboard</p>
      <p>Logado como: {user.email}</p>
      <p>
        <Link href="/dashboard/collection">Minha Coleção</Link>
      </p>
    </div>
  )
}
