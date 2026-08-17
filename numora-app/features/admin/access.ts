/**
 * features/admin/access.ts
 * Guarda de autorização administrativa (Etapa 15.3) — chamado UMA vez em
 * `app/admin/layout.tsx`, que protege todas as rotas `/admin/*` (o Next.js
 * sempre renderiza a cadeia de layouts, então acesso direto por URL a
 * `/admin/members`, `/admin/audit` etc. passa por aqui igualmente, sem
 * precisar repetir a checagem em cada página).
 *
 * A autorização real acontece no SERVIDOR, consultando `profiles.role`
 * (RLS `profiles_select_own` já permite a um usuário ler a própria linha —
 * nenhuma policy nova foi necessária para isto). Nunca compara e-mail
 * hardcoded, nunca confia em `app_metadata` do JWT (não populado hoje, ver
 * auditoria desta etapa). `is_platform_admin()` (banco) é quem
 * efetivamente protege as tabelas/RPCs administrativas — este helper é a
 * segunda camada, para nunca renderizar a UI administrativa para quem não
 * tem a role.
 *
 * `proxy.ts` continua sendo só o atalho de UX (redireciona para /login se
 * não há cookie de sessão) — o matcher foi estendido para incluir
 * `/admin/:path*`, mas ele não sabe nada sobre roles.
 */
import { redirect } from 'next/navigation'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { AdminRole } from '@/features/admin/types'

const ADMIN_ACCESS_ROLES: readonly AdminRole[] = ['owner', 'admin']

export interface AdminActor {
  id: string
  email: string | null
  role: AdminRole
}

/**
 * Redireciona para /login (sem sessão) ou /dashboard (logado, mas sem role
 * administrativa — redirect seguro, não revela a existência de níveis de
 * acesso) quando o acesso é negado. Só retorna quando o usuário é
 * owner/admin de verdade.
 */
export async function requireAdmin(): Promise<AdminActor> {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

  const role = profile?.role as AdminRole | undefined

  if (!role || !ADMIN_ACCESS_ROLES.includes(role)) {
    redirect('/dashboard')
  }

  return { id: user.id, email: user.email ?? null, role }
}
