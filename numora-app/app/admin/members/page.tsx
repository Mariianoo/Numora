/**
 * app/admin/members/page.tsx
 * Listagem administrativa de membros (Etapa 15.3 §6) — Client Component
 * (filtros/paginação sem reload, mesmo padrão de /dashboard/collection).
 * Toda leitura passa por `admin_list_members()` (RPC paginada no banco,
 * nunca "select * de todos os usuários" — Etapa 15.3 §21/§22).
 *
 * Filtros mostrados: só os que têm campo real por trás (plano efetivo,
 * cortesia ativa). "Trial"/"Parceiro"/"Cancelado"/"Bloqueado" foram
 * deliberadamente OMITIDOS — não existe hoje nenhuma coluna de status que
 * os sustente, e a etapa pede explicitamente para nunca inventar um filtro
 * sem campo real por trás (ver relatório).
 *
 * Etapa 15.9.1-R3: a coluna "Plano" não vem mais de `profiles.plan_tier`
 * (binário free/premium) — `admin_list_members()` agora resolve o plano
 * EFETIVO de cada membro via `effective_plans()` (Etapa 15.9.1-R2, fonte
 * única courtesy > subscription > free, set-based — 1 query para a página
 * inteira, nunca 1 chamada por membro). O filtro "Plano" ganhou a opção
 * "Pro", antes impossível de representar.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Gift, Ban, Search } from 'lucide-react'

import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { createSupabaseAdminRepository } from '@/features/admin/repositories/admin.repository'
import type { AdminMember, AdminRole, BenefitType, PlanSlug } from '@/features/admin/types'
import { planLabel, planBadgeTone } from '@/lib/plans/plan-display'
import { GrantCourtesyModal } from './GrantCourtesyModal'

const adminRepository = createSupabaseAdminRepository()
const PAGE_SIZE = 50

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  support: 'Support',
  finance: 'Finance',
  seller: 'Vendedor',
  user: 'Usuário',
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<AdminMember[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState<'all' | PlanSlug>('all')
  const [courtesyOnly, setCourtesyOnly] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Etapa 15.8-R4: só OWNER concede/revoga cortesia (RLS de `benefit_grants`
  // restrita a is_platform_owner() desde a R3) — `role == null` (ainda
  // carregando) é tratado como "sem privilégio", mesmo padrão de
  // components/ui/Sidebar.tsx, para nunca piscar o botão para ADMIN.
  const [role, setRole] = useState<AdminRole | null>(null)
  const isOwner = role === 'owner'

  const [grantTarget, setGrantTarget] = useState<AdminMember | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AdminMember | null>(null)
  const [isRevoking, setIsRevoking] = useState(false)

  useEffect(() => {
    adminRepository
      .getOwnRole()
      .then(setRole)
      .catch(() => setRole(null))
  }, [])

  // Encadeamento `.then()` (não async/await) de propósito — mesmo padrão já
  // usado em app/dashboard/collection/page.tsx (ver comentário lá,
  // `loadCollectionData`): `react-hooks/set-state-in-effect` só reconhece
  // que os `setState` abaixo NÃO são síncronos dentro do efeito quando
  // ficam dentro de callbacks `.then()` — envolver tudo em
  // `Promise.resolve().then(...)` garante que nada roda de forma síncrona
  // quando `loadMembers()` é chamada diretamente no `useEffect` abaixo.
  const loadMembers = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setIsLoading(true)
        setError(null)
        return adminRepository.listMembers({
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          planFilter: planFilter === 'all' ? null : planFilter,
          search: search || null,
        })
      })
      .then((result) => {
        setMembers(courtesyOnly ? result.members.filter((m) => m.courtesyActive) : result.members)
        setTotalCount(result.totalCount)
      })
      .catch((err) => {
        setError((err as Error).message)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [page, planFilter, search, courtesyOnly])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  async function handleGrantCourtesy(input: { type: BenefitType; plan: string; reason: string; expiresAt: string | null }) {
    if (!grantTarget) return
    await adminRepository.grantCourtesy({
      userId: grantTarget.id,
      type: input.type,
      plan: input.plan,
      reason: input.reason || null,
      expiresAt: input.expiresAt,
    })
    setGrantTarget(null)
    await loadMembers()
  }

  async function handleRevokeCourtesy() {
    if (!revokeTarget) return
    setIsRevoking(true)
    try {
      await adminRepository.revokeActiveCourtesy(revokeTarget.id)
      setRevokeTarget(null)
      await loadMembers()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsRevoking(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Membros" description={`${totalCount} membro${totalCount === 1 ? '' : 's'} cadastrado${totalCount === 1 ? '' : 's'}.`} />

      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Buscar"
            placeholder="Nome, e-mail ou username..."
            value={search}
            onChange={(event) => {
              setPage(0)
              setSearch(event.target.value)
            }}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            label="Plano"
            value={planFilter}
            onChange={(event) => {
              setPage(0)
              setPlanFilter(event.target.value as 'all' | PlanSlug)
            }}
          >
            <option value="all">Todos</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="premium">Premium</option>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={courtesyOnly}
            onChange={(event) => setCourtesyOnly(event.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          Só com cortesia ativa
        </label>
      </Card>

      {error ? (
        <ErrorState title="Não foi possível carregar os membros" description={error} actionLabel="Tentar novamente" onAction={loadMembers} />
      ) : !isLoading && members.length === 0 ? (
        <EmptyState icon={Search} title="Nenhum membro encontrado" description="Ajuste a busca ou os filtros." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-border bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Nome</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">E-mail</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Plano</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Papel</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Cadastro</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Último acesso</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Ações</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-primary">
                      {member.name ?? <span className="text-text-secondary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{member.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={planBadgeTone(member.planSlug)}>{planLabel(member.planSlug)}</Badge>
                        {member.courtesyActive && <Badge tone="success">Cortesia</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{ROLE_LABELS[member.role] ?? member.role}</td>
                    <td className="px-4 py-3 text-text-secondary">{dateFormatter.format(new Date(member.createdAt))}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {member.lastSignInAt ? dateTimeFormatter.format(new Date(member.lastSignInAt)) : 'Nunca'}
                    </td>
                    <td className="px-4 py-3">
                      {!isOwner ? (
                        <span className="text-text-secondary">—</span>
                      ) : member.courtesyActive ? (
                        <IconButton
                          icon={Ban}
                          aria-label="Revogar cortesia"
                          variant="danger"
                          size="sm"
                          onClick={() => setRevokeTarget(member)}
                        />
                      ) : (
                        <IconButton
                          icon={Gift}
                          aria-label="Conceder cortesia"
                          size="sm"
                          onClick={() => setGrantTarget(member)}
                        />
                      )}
                    </td>
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
              <Button variant="secondary" size="sm" disabled={page === 0 || isLoading} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page + 1 >= totalPages || isLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </Card>
      )}

      <GrantCourtesyModal member={grantTarget} onClose={() => setGrantTarget(null)} onSubmit={handleGrantCourtesy} />

      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeCourtesy}
        title="Revogar cortesia"
        description={`A cortesia ativa de ${revokeTarget?.name ?? revokeTarget?.email ?? ''} será encerrada agora.`}
        confirmLabel="Revogar cortesia"
        icon={Ban}
        isDestructive
        isLoading={isRevoking}
      />
    </div>
  )
}
