/**
 * app/admin/health/page.tsx
 * Numora Health — Etapa 15.10.7. Camada de observabilidade interna do
 * produto, exclusiva do OWNER. Server Component, mesmo padrão de
 * `app/admin/page.tsx`: client de servidor direto, sem repositório (só
 * leitura, sem mutação).
 *
 * Autorização: `requireAdmin()` (já bloqueia USER→/login ou /dashboard,
 * como em toda rota `/admin/*`) seguido de uma checagem adicional
 * `actor.role !== 'owner'` → `redirect('/admin')` — o MESMO padrão já usado
 * por `OwnerCommercialSection` (que só é buscada/renderizada quando
 * `role === 'owner'` dentro de `/admin/page.tsx`), só que aplicado no nível
 * da página inteira em vez de uma seção condicional. Nenhum mecanismo de
 * autorização novo — `is_platform_owner()` (banco) continua sendo a
 * barreira real via a RPC `admin_health_snapshot()`.
 *
 * Platform Health: cada indicador é o resultado REAL de uma chamada que
 * esta página já precisa fazer — não existe nenhum "ping" sintético.
 * - Database: sucesso de `admin_health_snapshot()` (consulta profiles +
 *   collection_items diretamente).
 * - Authentication: `requireAdmin()` já resolveu sessão+role para a página
 *   sequer renderizar — este indicador é, por natureza, sempre 🟢 quando
 *   visível (documentado explicitamente na UI: prova que a autenticação
 *   funcionou NESTA requisição, não é um monitor de uptime contínuo).
 * - Admin RPC: sucesso de `admin_dashboard_metrics()` (RPC administrativa
 *   já usada pelo restante do Owner Center — valida esse pipeline
 *   especificamente, não duplica o check de Database).
 * - Effective Plan: sucesso de `get_effective_plan()` para o próprio OWNER
 *   — valida a cadeia de resolução de plano sem reimplementá-la.
 *
 * Growth/Product Usage: `admin_health_snapshot()` (Etapa 15.10.7, RPC
 * nova, OWNER-only, agregação single-pass — ver migration
 * `create_admin_health_snapshot`). `total_members`/`active_members_30d`
 * vêm de `admin_dashboard_metrics()` (já existente, reaproveitado, nunca
 * recalculado aqui). First-item conversion = members_with_item/total_members,
 * calculado em memória a partir dos dois retornos acima — divisão por zero
 * tratada explicitamente (mostra "—", nunca NaN/Infinity).
 *
 * Commercial: reaproveita só `admin_plan_distribution()` (distribuição por
 * plano) e `admin_dashboard_metrics().courtesyActive` — nenhuma query
 * comercial nova. MRR/Receita não são repetidos aqui (já vivem em
 * `OwnerCommercialSection`, `/admin`) — só um link diz honestamente que
 * dependem do Stripe, sem duplicar o card "—".
 *
 * Analytics (eventos `dataLayer` da Etapa 15.10.4) NUNCA é fonte de nenhum
 * número aqui — só o banco.
 */
import { redirect } from 'next/navigation'
import { Activity, Layers, TrendingUp, UserPlus, Users, Coins, PackagePlus, Gauge, CreditCard, Gift } from 'lucide-react'

import { requireAdmin } from '@/features/admin/access'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { DistributionCard } from '@/app/dashboard/DistributionCard'
import { mapPlanDistribution, type OwnerCenterPlanRow, type OwnerCenterPlanDistributionRow } from '@/lib/stats/owner-center-stats'

interface AdminHealthSnapshotRow {
  new_members_today: number
  new_members_7d: number
  new_members_30d: number
  total_collection_items: number
  members_with_item: number
  item_additions_7d: number
  item_additions_30d: number
}

interface AdminMetricsRow {
  total_members: number
  active_members_30d: number
  free_members: number
  premium_members: number
  courtesy_active: number
  coins_count: number
  units_count: number
  purchases_count: number
  passports_published: number
  images_stored: number
}

function HealthRow({ label, healthy, note }: { label: string; healthy: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {note && <p className="mt-0.5 text-xs text-text-secondary">{note}</p>}
      </div>
      <Badge tone={healthy ? 'success' : 'danger'}>{healthy ? '🟢 Healthy' : '🔴 Critical'}</Badge>
    </div>
  )
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export default async function AdminHealthPage() {
  const actor = await requireAdmin()

  if (actor.role !== 'owner') {
    redirect('/admin')
  }

  const supabase = await getSupabaseServerClient()

  const [snapshotResult, metricsResult, planResult, plansResult, distributionResult] = await Promise.all([
    supabase.rpc('admin_health_snapshot').single(),
    supabase.rpc('admin_dashboard_metrics').single(),
    supabase.rpc('get_effective_plan', { p_user_id: actor.id }).maybeSingle(),
    supabase.from('plans').select('id, slug, name, active'),
    supabase.rpc('admin_plan_distribution'),
  ])

  const databaseHealthy = !snapshotResult.error
  const adminRpcHealthy = !metricsResult.error
  const effectivePlanHealthy = !planResult.error

  const snapshot = snapshotResult.data as AdminHealthSnapshotRow | null
  const metrics = metricsResult.data as AdminMetricsRow | null

  const plans = (plansResult.data ?? []) as OwnerCenterPlanRow[]
  const planDistributionRows = (distributionResult.data ?? []) as OwnerCenterPlanDistributionRow[]
  const planDistribution = mapPlanDistribution(plans, planDistributionRows)

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Numora Health"
        description="Observabilidade interna do produto — exclusivo do OWNER. Consulta fontes já existentes, nunca reimplementa regra de negócio."
      />

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-accent" aria-hidden />
          <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Platform Health</p>
        </div>
        <Card className="p-5">
          <HealthRow label="Database" healthy={databaseHealthy} note="Consulta real a profiles + collection_items." />
          <HealthRow
            label="Authentication"
            healthy
            note="Sessão e role já resolvidas para esta página renderizar — prova esta requisição, não é monitor contínuo."
          />
          <HealthRow label="Admin RPC" healthy={adminRpcHealthy} note="admin_dashboard_metrics() — pipeline usado por todo o Owner Center." />
          <HealthRow label="Effective Plan" healthy={effectivePlanHealthy} note="get_effective_plan() — sem reimplementar a regra de plano." />
        </Card>
        <p className="text-xs text-text-secondary">
          Estes indicadores refletem a saúde da aplicação nesta requisição — não são um monitor de uptime externo da
          infraestrutura (Vercel/Supabase), que exigiria uma integração futura (ver relatório da etapa).
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-accent" aria-hidden />
          <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Growth</p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard icon={UserPlus} label="Novos hoje" value={String(snapshot?.new_members_today ?? '—')} />
          <StatCard icon={UserPlus} label="Novos 7 dias" value={String(snapshot?.new_members_7d ?? '—')} />
          <StatCard icon={UserPlus} label="Novos 30 dias" value={String(snapshot?.new_members_30d ?? '—')} />
          <StatCard icon={Users} label="Total de membros" value={String(metrics?.total_members ?? '—')} />
          <StatCard
            icon={Gauge}
            label="Ativos 30d"
            value={String(metrics?.active_members_30d ?? '—')}
            description="Login nos últimos 30 dias"
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Coins className="size-4 text-accent" aria-hidden />
          <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Product Usage</p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard icon={Coins} label="Itens na plataforma" value={String(snapshot?.total_collection_items ?? '—')} />
          <StatCard icon={Users} label="Membros com coleção" value={String(snapshot?.members_with_item ?? '—')} />
          <StatCard
            icon={Gauge}
            label="Conversão 1º item"
            value={snapshot && metrics ? formatPercent(snapshot.members_with_item, metrics.total_members) : '—'}
            description="Membros com coleção / total de membros"
          />
          <StatCard icon={PackagePlus} label="Itens adicionados 7d" value={String(snapshot?.item_additions_7d ?? '—')} />
          <StatCard icon={PackagePlus} label="Itens adicionados 30d" value={String(snapshot?.item_additions_30d ?? '—')} />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-accent" aria-hidden />
          <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Commercial</p>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DistributionCard
            title="Distribuição por plano"
            icon={Layers}
            entries={planDistribution}
            emptyMessage="Nenhum membro cadastrado ainda."
          />
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-secondary">Cortesias ativas</p>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Gift className="size-[18px]" aria-hidden />
              </div>
            </div>
            <p className="mt-3 text-lg font-semibold tracking-tight text-text-primary sm:text-xl lg:text-3xl">
              {metrics?.courtesy_active ?? '—'}
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              MRR/Receita: Stripe ainda não configurado — ver detalhes em{' '}
              <a href="/admin" className="text-accent underline">
                /admin
              </a>
              . Nenhum número é fabricado aqui.
            </p>
          </Card>
        </div>
      </section>

      <p className="text-xs text-text-secondary">
        Todas as métricas acima vêm do banco (profiles, collection_items, effective_plans, benefit_grants) — nunca dos
        eventos de analytics client-side (landing_view, item_added etc.), que são efêmeros e sujeitos a consentimento.
      </p>
    </div>
  )
}
