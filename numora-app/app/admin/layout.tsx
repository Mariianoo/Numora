/**
 * app/admin/layout.tsx
 * Guarda de autorização real do Admin Control Center (Etapa 15.3).
 *
 * `requireAdmin()` roda no servidor, para TODA rota `/admin/*` — o Next.js
 * sempre renderiza a cadeia de layouts para qualquer rota aninhada
 * correspondente, então acesso direto por URL a `/admin/members`,
 * `/admin/audit`, `/admin/settings` etc. passa por este mesmo gate, sem
 * precisar repetir a checagem em cada página. `proxy.ts` (matcher
 * `/admin/:path*`) só cobre a ausência total de sessão (atalho de UX); a
 * checagem de ROLE só existe aqui.
 */
import { requireAdmin } from '@/features/admin/access'
import { AdminShell } from '@/components/admin/AdminShell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return <AdminShell>{children}</AdminShell>
}
