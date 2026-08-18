/**
 * app/admin/OwnerCommercialSection.tsx
 * OWNER CENTER — Visão Comercial (Etapa 15.9.1) — Server Component
 * puramente apresentacional: recebe os dados já buscados/calculados por
 * `app/admin/page.tsx` (que decide, sozinho, se este componente sequer é
 * renderizado — só quando `role === 'owner'`, ver Fase 4/Segurança do
 * relatório da etapa). Este componente NÃO refaz a checagem de role: a
 * proteção real está em nunca ser chamado para ADMIN, exatamente como
 * `benefit_grants`/cortesia na Etapa 15.8-R4 (RLS no banco continua sendo a
 * barreira de fato — isto é só apresentação).
 *
 * Reaproveita os mesmos componentes genéricos do Dashboard 2.0
 * (StatCard/DistributionCard/MonthlySeriesChart, Etapas 13.1/13.2) — nenhum
 * componente de gráfico novo foi criado.
 *
 * MRR e Receita mostram "—" com explicação em vez de qualquer número: hoje
 * `plan_prices`/`billing_transactions` estão vazias em produção (nenhum
 * preço comercial ativo, nenhuma transação Stripe) — ver relatório da
 * etapa, "Métricas indisponíveis".
 */
import { CreditCard, Wallet, TrendingUp, Layers, PieChart, LineChart, Receipt } from 'lucide-react'

import type { DistributionEntry, MonthlyAcquisitionEntry } from '@/lib/stats/collection-stats'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { DistributionCard } from '@/app/dashboard/DistributionCard'
import { MonthlySeriesChart } from '@/app/dashboard/MonthlySeriesChart'

export interface OwnerCommercialSectionProps {
  planDistribution: DistributionEntry[]
  subscriptionStatusDistribution: DistributionEntry[]
  subscriptionsTotal: number
  activePlansCount: number
  memberGrowth: MonthlyAcquisitionEntry[]
}

function UnavailableMetricCard({
  icon: Icon,
  label,
  reason,
}: {
  icon: typeof Wallet
  label: string
  reason: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon className="size-[18px]" aria-hidden />
        </div>
      </div>
      <p className="mt-3 text-lg font-semibold tracking-tight text-text-primary sm:text-xl lg:text-3xl">—</p>
      <p className="mt-1 text-xs text-text-secondary">{reason}</p>
    </Card>
  )
}

export function OwnerCommercialSection({
  planDistribution,
  subscriptionStatusDistribution,
  subscriptionsTotal,
  activePlansCount,
  memberGrowth,
}: OwnerCommercialSectionProps) {
  return (
    <section className="flex flex-col gap-6 border-t border-border pt-8">
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">Owner Center</p>
        <h2 className="mt-1 text-lg font-semibold text-text-primary">Visão comercial</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Exclusivo do OWNER — autoridade comercial da plataforma (Etapa 15.9.1).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
        <StatCard icon={CreditCard} label="Assinaturas" value={String(subscriptionsTotal)} description="Total de registros" />
        <StatCard icon={Layers} label="Planos ativos" value={String(activePlansCount)} description="Catálogo vendável hoje" />
        <UnavailableMetricCard icon={Wallet} label="MRR" reason="plan_prices ainda não tem nenhum preço comercial ativo." />
        <UnavailableMetricCard icon={TrendingUp} label="Receita" reason="billing_transactions ainda não tem nenhuma transação." />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DistributionCard
          title="Distribuição por plano"
          icon={PieChart}
          entries={planDistribution}
          emptyMessage="Nenhum membro cadastrado ainda."
        />
        <DistributionCard
          title="Assinaturas por status"
          icon={Receipt}
          entries={subscriptionStatusDistribution}
          emptyMessage="Nenhuma assinatura registrada ainda — fundação de billing sem Stripe integrado."
        />
      </div>

      <MonthlySeriesChart
        title="Crescimento de membros"
        icon={LineChart}
        entries={memberGrowth}
        emptyMessage="Nenhum cadastro nos últimos 12 meses."
        formatValue={(value) => String(value)}
      />
    </section>
  )
}
