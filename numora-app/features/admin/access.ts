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
 *
 * `getSessionAndRole` (Etapa 15.9.1): a busca em si (auth.getUser() +
 * profiles.role) é envolvida em `cache()` do React — dedupe por request,
 * não um cache entre requests. `app/admin/layout.tsx` já chama
 * `requireAdmin()` para todo `/admin/*`; quando uma página também precisa
 * saber a role (ex.: `app/admin/page.tsx` decidindo se mostra a seção
 * comercial exclusiva do OWNER), chamar `requireAdmin()` de novo reaproveita
 * o mesmo resultado desta função dentro do mesmo request — sem 2ª consulta
 * ao Supabase. `requireAdmin()` continua com a mesma assinatura/
 * comportamento público (redirects), só a busca interna foi extraída.
 */
import { cache } from 'react'
import { redirect } from 'next/navigation'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { AdminRole } from '@/features/admin/types'

const ADMIN_ACCESS_ROLES: readonly AdminRole[] = ['owner', 'admin']

export interface AdminActor {
  id: string
  email: string | null
  role: AdminRole
}

const getSessionAndRole = cache(async (): Promise<{ userId: string; email: string | null; role: AdminRole | undefined } | null> => {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

  return { userId: user.id, email: user.email ?? null, role: profile?.role as AdminRole | undefined }
})

/**
 * Redireciona para /login (sem sessão) ou /dashboard (logado, mas sem role
 * administrativa — redirect seguro, não revela a existência de níveis de
 * acesso) quando o acesso é negado. Só retorna quando o usuário é
 * owner/admin de verdade.
 */
export async function requireAdmin(): Promise<AdminActor> {
  const session = await getSessionAndRole()

  if (!session) {
    redirect('/login')
  }

  if (!session.role || !ADMIN_ACCESS_ROLES.includes(session.role)) {
    redirect('/dashboard')
  }

  return { id: session.userId, email: session.email, role: session.role }
}
