/**
 * app/admin/audit/page.tsx
 * Visualização somente-leitura de `admin_audit_logs` (Etapa 15.3 §10) —
 * Server Component, mesmo padrão de `app/dashboard/page.tsx`: client de
 * servidor direto, sem repositório (não há mutação nesta tela).
 *
 * `actor`/`target` vêm via embed PostgREST para `profiles` (2 relações
 * distintas da mesma tabela — hint `!actor_user_id`/`!target_user_id` para
 * desambiguar, mesmo padrão já usado em `metals!metal_code`). RLS de
 * `admin_audit_logs` (`admin_audit_logs_select_admin`) e de `profiles`
 * (`profiles_select_admin`, adicionada nesta etapa) já garantem que só um
 * administrador chega até aqui com dados.
 */
import Link from 'next/link'
import { ScrollText } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/components/ui/utils'

const PAGE_LINK_CLASSES =
  'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface-hover px-3 text-sm font-medium text-text-primary transition-colors hover:bg-surface'
const PAGE_LINK_DISABLED_CLASSES = 'pointer-events-none opacity-50'

const PAGE_SIZE = 50

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })

interface AuditLogRow {
  id: string
  action: string
  created_at: string
  metadata: Record<string, unknown>
  actor: { name: string | null; email: string | null } | null
  target: { name: string | null; email: string | null } | null
}

function actorLabel(actor: AuditLogRow['actor']): string {
  if (!actor) return 'Desconhecido'
  return actor.name ?? actor.email ?? 'Desconhecido'
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageParam } = await searchParams
  const page = Math.max(0, Number(pageParam ?? '0') || 0)

  const supabase = await getSupabaseServerClient()
  const { data, error, count } = await supabase
    .from('admin_audit_logs')
    .select('id, action, created_at, metadata, actor:profiles!actor_user_id(name,email), target:profiles!target_user_id(name,email)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  const entries = (data ?? []) as unknown as AuditLogRow[]
  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Auditoria" description="Trilha de ações administrativas — quem fez o quê, em quem, quando." />

      {error ? (
        <ErrorState title="Não foi possível carregar a auditoria" description="Ocorreu um problema ao consultar o banco." />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nenhuma ação administrativa registrada ainda" />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Quando</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Quem</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Ação</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Em quem</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-text-secondary">
                      {dateTimeFormatter.format(new Date(entry.created_at))}
                    </td>
                    <td className="px-4 py-3 text-text-primary">{actorLabel(entry.actor)}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-surface-hover px-1.5 py-0.5 text-xs text-text-primary">
                        {entry.action}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{entry.target ? actorLabel(entry.target) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-text-secondary">
              Página {page + 1} de {totalPages}
            </p>
            <div className="flex gap-2">
              <Link
                href={`/admin/audit?page=${page - 1}`}
                aria-disabled={page === 0}
                className={cn(PAGE_LINK_CLASSES, page === 0 && PAGE_LINK_DISABLED_CLASSES)}
              >
                Anterior
              </Link>
              <Link
                href={`/admin/audit?page=${page + 1}`}
                aria-disabled={page + 1 >= totalPages}
                className={cn(PAGE_LINK_CLASSES, page + 1 >= totalPages && PAGE_LINK_DISABLED_CLASSES)}
              >
                Próxima
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
