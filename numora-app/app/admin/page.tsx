/**
 * app/admin/page.tsx
 * Visão executiva do Admin Control Center (Etapa 15.3) — Server Component,
 * mesmo padrão de `app/dashboard/page.tsx`: client de servidor direto, sem
 * repositório (leitura simples, sem interação).
 *
 * Todas as métricas vêm de `admin_dashboard_metrics()` (RPC única,
 * agregada no banco — sem N+1, sem carregar linha por usuário). Nenhum
 * dado de receita/pagamento é fabricado: Stripe não está configurado nesta
 * etapa, e os cards "Pagantes"/"Receita" mostram esse estado explicitamente
 * em vez de um número inventado.
 *
 * Etapa 15.9.1 (OWNER CENTER — Visão Geral): tudo acima desta linha
 * continua idêntico para ADMIN e OWNER (zero regressão). Uma seção nova,
 * `<OwnerCommercialSection>`, só é buscada/renderizada quando
 * `requireAdmin().role === 'owner'` — comparação direta com a mesma coluna
 * que `is_platform_owner()` (banco) verifica; não é uma segunda definição
 * de OWNER, é o mesmo dado (`profiles.role`) já em mãos por já termos
 * chamado `requireAdmin()` aqui (deduplicado via `cache()` com a chamada
 * que `app/admin/layout.tsx` já faz — ver features/admin/access.ts). ADMIN
 * nunca dispara as 4 queries comerciais novas: elas só rodam dentro do
 * `if (role === 'owner')`.
 *
 * Etapa 15.9.1-R2 (Fonte Única de Plano Efetivo): a distribuição Free/Pro/
 * Premium não é mais calculada aqui a partir de `benefit_grants`/
 * `subscriptions` brutos — vem pronta de `admin_plan_distribution()` (RPC
 * OWNER-only, banco), a única fonte da prioridade courtesy > subscription >
 * free. `subscriptions` continua sendo buscada (agora só a coluna
 * `status`) exclusivamente para o card "Assinaturas por status", que nunca
 * dependeu dessa prioridade.
 */
import { Users, UserCheck, CreditCard, Wallet, Gift, TrendingUp, Coins, Layers, ShoppingCart, IdCard, Image as ImageIcon } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { clientEnv } from '@/lib/env.server'
import { requireAdmin } from '@/features/admin/access'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { OwnerCommercialSection } from './OwnerCommercialSection'
import {
  mapPlanDistribution,
  computeSubscriptionStatusDistribution,
  computeMemberGrowth,
  type OwnerCenterPlanRow,
  type OwnerCenterPlanDistributionRow,
} from '@/lib/stats/owner-center-stats'

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

function projectRefFromUrl(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return 'desconhecido'
  }
}

export default async function AdminDashboardPage() {
  const actor = await requireAdmin()
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.rpc('admin_dashboard_metrics').single()
  const metrics = data as AdminMetricsRow | null
  const loadedAt = new Date()

  const isOwner = actor.role === 'owner'

  let ownerCommercialProps: {
    planDistribution: ReturnType<typeof mapPlanDistribution>
    subscriptionStatusDistribution: ReturnType<typeof computeSubscriptionStatusDistribution>
    subscriptionsTotal: number
    activePlansCount: number
    memberGrowth: ReturnType<typeof computeMemberGrowth>
  } | null = null

  if (isOwner && metrics) {
    const [plansResult, distributionResult, subscriptionsResult, profilesResult] = await Promise.all([
      supabase.from('plans').select('id, slug, name, active'),
      supabase.rpc('admin_plan_distribution'),
      supabase.from('subscriptions').select('status'),
      supabase.from('profiles').select('created_at'),
    ])

    const plans = (plansResult.data ?? []) as OwnerCenterPlanRow[]
    const planDistributionRows = (distributionResult.data ?? []) as OwnerCenterPlanDistributionRow[]
    const subscriptions = (subscriptionsResult.data ?? []) as { status: string }[]
    const profileCreatedAtValues = (profilesResult.data ?? []).map((p) => p.created_at as string)

    ownerCommercialProps = {
      planDistribution: mapPlanDistribution(plans, planDistributionRows),
      subscriptionStatusDistribution: computeSubscriptionStatusDistribution(subscriptions),
      subscriptionsTotal: subscriptions.length,
      activePlansCount: plans.filter((p) => p.active).length,
      memberGrowth: computeMemberGrowth(profileCreatedAtValues),
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Visão geral" description="Estado atual da plataforma Numora." />

      {error || !metrics ? (
        <ErrorState
          title="Não foi possível carregar as métricas administrativas"
          description="Ocorreu um problema ao consultar o banco."
        />
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Membros</p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
              <StatCard icon={Users} label="Membros" value={String(metrics.total_members)} description="Total cadastrado" />
              <StatCard
                icon={UserCheck}
                label="Membros ativos"
                value={String(metrics.active_members_30d)}
                description="Login nos últimos 30 dias"
              />
              <StatCard
                icon={CreditCard}
                label="Pagantes"
                value="Stripe não configurado"
                description="Sem fonte de pagamento real ainda"
              />
              <StatCard icon={Wallet} label="Free" value={String(metrics.free_members)} description="Plano gratuito" />
              <StatCard icon={Gift} label="Cortesias" value={String(metrics.courtesy_active)} description="Benefícios vigentes" />
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Receita</p>
            <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <TrendingUp className="size-[18px]" aria-hidden />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">Stripe ainda não configurado</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    Configure o Stripe para começar a receber assinaturas e acompanhar receitas reais.
                  </p>
                  <p className="mt-1 text-xs text-text-secondary/70">
                    Nenhum dado de receita é fabricado — este card só passa a mostrar números reais quando o Stripe Billing for integrado (fora do escopo desta etapa).
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" disabled className="shrink-0">
                Configurar pagamentos
              </Button>
            </Card>
          </section>

          <section className="flex flex-col gap-4">
            <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
              Métricas de produto
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
              <StatCard icon={Coins} label="Moedas cadastradas" value={String(metrics.coins_count)} description="Itens ativos" />
              <StatCard icon={Layers} label="Exemplares" value={String(metrics.units_count)} description="Unidades ativas" />
              <StatCard icon={ShoppingCart} label="Compras" value={String(metrics.purchases_count)} description="Purchases registradas" />
              <StatCard icon={IdCard} label="Passports públicos" value={String(metrics.passports_published)} description="Perfis publicados" />
              <StatCard icon={ImageIcon} label="Imagens" value={String(metrics.images_stored)} description="Fotos armazenadas" />
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">Infraestrutura</p>
            <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
              <div className="flex items-center gap-2">
                <Badge tone="success">Conectado</Badge>
                <span className="text-sm text-text-secondary">Supabase respondendo normalmente</span>
              </div>
              <div className="text-sm text-text-secondary">
                Projeto: <span className="text-text-primary">{projectRefFromUrl(clientEnv.NEXT_PUBLIC_SUPABASE_URL)}</span>
              </div>
              <div className="text-sm text-text-secondary">
                Última verificação:{' '}
                <span className="text-text-primary">
                  {loadedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            </Card>
            <p className="text-xs text-text-secondary">
              Métricas de custo/uso do projeto Supabase (storage, database, egress) não estão disponíveis aqui — exigiriam a API de billing/management do Supabase, que nunca deve ser chamada com credenciais expostas ao browser. Ver relatório desta etapa para a avaliação completa.
            </p>
          </section>

          {ownerCommercialProps && <OwnerCommercialSection {...ownerCommercialProps} />}
        </>
      )}
    </div>
  )
}
