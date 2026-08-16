/**
 * app/dashboard/page.tsx
 * Página protegida. O proxy já bloqueia acesso sem sessão, mas a página
 * também verifica a sessão via supabase server client — segunda camada
 * de defesa, não depende só do proxy.
 *
 * Estatísticas com dado real (Etapa de integração): esta é uma página
 * Server Component, que usa o client Supabase de servidor diretamente
 * (mesmo padrão já existente aqui para obter `user`) — não passa pelos
 * repositories de features/collection e features/purchases, que são
 * client-side (usam o client de browser) e servem os componentes
 * interativos de /dashboard/collection.
 *
 * Etapa UI/UX: única query nova é `profiles.name` (saudação "Bom dia,
 * {nome}", com fallback para a parte local do e-mail) — as 3 queries de
 * estatísticas permanecem exatamente como eram antes desta etapa.
 *
 * Etapa 8.1: o cálculo de estatísticas e a formatação de data foram
 * extraídos para lib/stats/collection-stats.ts e lib/format/date.ts
 * (reutilizados por app/dashboard/profile/page.tsx) — mesmo
 * comportamento de antes, só movido de lugar. A query de
 * `collection_items` passou a incluir `metal_code` (antes só
 * `quantity, country_code`) porque o helper compartilhado também
 * calcula metais representados, usado no Perfil; o Dashboard não exibe
 * esse número, então não há mudança visível aqui.
 *
 * Etapa 13.1 (Dashboard 2.0 — auditoria Etapa 13, só dados 🟢): a query de
 * `collection_items` ganhou embeds (`countries`, `metals`,
 * `collection_units.grades`) — mesmo padrão de embed já usado em
 * `collection.repository.ts` (ITEM_SELECT), continua sendo 1 única query,
 * sem N+1 e sem RPC nova. Nenhuma tabela de vendas/histórico é tocada
 * (fora de escopo desta etapa, ver auditoria §14/§15).
 *
 * Etapa 13.2 (auditoria "Aquisições"): nova seção "Aquisições" com 1
 * query adicional (`purchases` + embed de `collection_items`, SEM o
 * filtro `deleted_at is null` usado no resumo acima) — decisão explícita
 * desta etapa de tratar compras como HISTÓRICO: uma compra não some
 * daqui só porque o item foi para a lixeira depois. `totalInvested`/
 * "Resumo da coleção" continuam com a semântica antiga (coleção atual),
 * sem nenhuma alteração de comportamento.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Coins,
  Layers,
  Globe2,
  Wallet,
  ShoppingBag,
  ShoppingCart,
  Banknote,
  CalendarRange,
  PackageOpen,
  PackagePlus,
  Receipt,
  Gem,
  Award,
  Tag,
} from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  computeCollectionStats,
  computeAverageAcquisitionCost,
  computeCountryDistribution,
  computeMetalDistribution,
  computeGradeDistribution,
  computeStatusDistribution,
  computeTicketMedio,
  selectRecentAcquisitions,
  computeMonthlyAcquisitionValue,
  computeMonthlyAcquisitionQuantity,
  type CollectionItemStatsRow,
  type PurchaseStatsRow,
  type CollectionItemDistributionRow,
  type CollectionUnitDistributionRow,
  type AcquisitionPurchaseRow,
} from '@/lib/stats/collection-stats'
import { formatDateOnly } from '@/lib/format/date'
import { DashboardErrorState } from './DashboardErrorState'
import { DistributionCard } from './DistributionCard'
import { AcquisitionsList } from './AcquisitionsList'
import { MonthlySeriesChart } from './MonthlySeriesChart'

interface LastPurchaseRow {
  total_price: number
  seller_name: string | null
  purchase_date: string | null
}

interface DashboardItemRow {
  quantity: number
  country_code: string | null
  metal_code: string | null
  countries: { name: string; flag_emoji: string | null } | null
  metals: { name: string } | null
  collection_units: { status: string; grade_id: string | null; grades: { label: string } | null }[]
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [itemsResult, purchasesResult, lastPurchaseResult, acquisitionsResult, profileResult] = await Promise.all([
    // Etapa 13.1: embeds de `countries`/`metals`/`collection_units(grades)`
    // adicionados para as distribuições — mesma query única de sempre,
    // sem N+1 (PostgREST resolve os embeds no próprio Postgres).
    supabase
      .from('collection_items')
      .select(
        'quantity, country_code, metal_code, countries ( name, flag_emoji ), metals!metal_code ( name ), collection_units ( status, grade_id, grades ( label ) )',
      )
      .is('deleted_at', null),
    // `collection_items!inner(id)` + filtro no embed = EXISTS: só traz a
    // purchase se houver ao menos 1 collection_item ATIVO vinculado (Etapa
    // Lixeira). Uma purchase compartilhada por vários itens continua
    // aparecendo aqui uma única vez (o embed vira array aninhado, não
    // duplica a linha de purchases) — sem N+1, uma query só.
    supabase.from('purchases').select('total_price, collection_items!inner(id)').is('collection_items.deleted_at', null),
    supabase
      .from('purchases')
      .select('total_price, seller_name, purchase_date, collection_items!inner(id)')
      .is('collection_items.deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Etapa 13.2: SEM `.is('deleted_at', null)`/`!inner` — histórico de
    // aquisições inclui compras cujo item foi para a lixeira depois
    // (decisão explícita, ver comentário no topo do arquivo). Mesmo
    // padrão de embed único, sem N+1: cada compra traz seus
    // `collection_items` aninhados numa única viagem ao banco.
    supabase
      .from('purchases')
      .select('id, total_price, purchase_date, seller_name, created_at, collection_items(id, denomination, quantity, deleted_at)')
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('name').eq('id', user.id).maybeSingle(),
  ])

  // Etapa 12.4: uma falha de query NUNCA deve virar silenciosamente "0
  // moedas"/"coleção vazia" — a auditoria encontrou exatamente esse
  // mascaramento aqui (nenhum dos 4 resultados tinha `.error` checado).
  // Cada bloco (resumo/coleção vs. última aquisição) falha de forma
  // independente, preservando os que carregaram com sucesso.
  const hasStatsError = Boolean(itemsResult.error || purchasesResult.error)
  const hasLastPurchaseError = Boolean(lastPurchaseResult.error)
  const hasAcquisitionsError = Boolean(acquisitionsResult.error)

  const dashboardItems = (itemsResult.data ?? []) as unknown as DashboardItemRow[]
  const items = dashboardItems as CollectionItemStatsRow[]
  const purchases = (purchasesResult.data ?? []) as PurchaseStatsRow[]
  const lastPurchase = lastPurchaseResult.data as LastPurchaseRow | null
  const acquisitionPurchases = (acquisitionsResult.data ?? []) as unknown as AcquisitionPurchaseRow[]
  const profileName = (profileResult.data as { name: string | null } | null)?.name

  const displayName = profileName?.trim() || user.email?.split('@')[0] || 'colecionador'

  const { totalItems, totalUnits, countryCount, totalInvested } = hasStatsError
    ? { totalItems: 0, totalUnits: 0, countryCount: 0, totalInvested: 0 }
    : computeCollectionStats(items, purchases)

  const averageAcquisitionCost = hasStatsError ? null : computeAverageAcquisitionCost(totalInvested, totalUnits)

  // Etapa 13.1: país/metal são atributos da MOEDA (collection_item);
  // conservação/status são atributos do EXEMPLAR (collection_unit) — a
  // mesma separação já usada em toda a Coleção, nunca combinada aqui.
  const countryDistributionRows: CollectionItemDistributionRow[] = dashboardItems.map((item) => ({
    country_code: item.country_code,
    country_name: item.countries?.name ?? null,
    country_flag_emoji: item.countries?.flag_emoji ?? null,
    metal_code: item.metal_code,
    metal_name: item.metals?.name ?? null,
  }))
  const unitDistributionRows: CollectionUnitDistributionRow[] = dashboardItems.flatMap((item) =>
    item.collection_units.map((unit) => ({
      status: unit.status,
      grade_id: unit.grade_id,
      grade_label: unit.grades?.label ?? null,
    })),
  )

  const countryDistribution = hasStatsError ? [] : computeCountryDistribution(countryDistributionRows)
  const metalDistribution = hasStatsError ? [] : computeMetalDistribution(countryDistributionRows)
  const gradeDistribution = hasStatsError ? [] : computeGradeDistribution(unitDistributionRows)
  const statusDistribution = hasStatsError ? [] : computeStatusDistribution(unitDistributionRows)

  // Etapa 13.2: número de compras = número de OPERAÇÕES (uma linha em
  // `purchases`), nunca a soma de exemplares — uma compra com vários
  // itens continua contando 1.
  const numeroCompras = hasAcquisitionsError ? 0 : acquisitionPurchases.length
  const ticketMedio = hasAcquisitionsError ? null : computeTicketMedio(acquisitionPurchases)
  const recentAcquisitions = hasAcquisitionsError ? [] : selectRecentAcquisitions(acquisitionPurchases, 5)
  const monthlyAcquisitionValue = hasAcquisitionsError ? [] : computeMonthlyAcquisitionValue(acquisitionPurchases)
  const monthlyAcquisitionQuantity = hasAcquisitionsError ? [] : computeMonthlyAcquisitionQuantity(acquisitionPurchases)

  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const compactCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const quantityFormatter = new Intl.NumberFormat('pt-BR')

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={`${getGreeting()}, ${displayName}`} description="Veja como está sua coleção." />

      <section className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
          Resumo da coleção
        </p>
        {hasStatsError ? (
          <DashboardErrorState
            title="Não foi possível carregar seu resumo"
            description="Ocorreu um problema ao carregar os dados da sua coleção."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
            {/* Etapa 13.2: 5 cards espremidos em 5 colunas a partir de
                1024px estouravam valores monetários maiores (ex.:
                "R$ 1.720,00"). Ajuste só de grid (não de fonte): 3 colunas
                num intervalo intermediário, 5 só a partir de telas bem
                largas (2xl), onde sobra espaço de verdade por card. */}
            <StatCard icon={Coins} label="Moedas" value={String(totalItems)} description="Itens cadastrados" />
            <StatCard icon={Layers} label="Unidades" value={String(totalUnits)} description="Peças na coleção" />
            <StatCard
              icon={Globe2}
              label="Países"
              value={String(countryCount)}
              description="Países representados"
            />
            <StatCard
              icon={Wallet}
              label="Investido na coleção"
              value={currencyFormatter.format(totalInvested)}
              description="Considera apenas itens ativos da coleção."
            />
            <StatCard
              icon={Receipt}
              label="Valor médio"
              value={averageAcquisitionCost === null ? '—' : currencyFormatter.format(averageAcquisitionCost)}
              description="Por exemplar ativo"
            />
          </div>
        )}
      </section>

      {!hasStatsError && totalItems > 0 && (
        <section className="flex flex-col gap-4">
          <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
            Distribuição da coleção
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DistributionCard
              title="Por país"
              icon={Globe2}
              entries={countryDistribution}
              emptyMessage="Nenhum país informado ainda."
            />
            <DistributionCard
              title="Por metal"
              icon={Gem}
              entries={metalDistribution}
              emptyMessage="Nenhum metal informado ainda."
            />
            <DistributionCard
              title="Por conservação"
              icon={Award}
              entries={gradeDistribution}
              emptyMessage="Nenhuma conservação informada ainda."
            />
            <DistributionCard
              title="Por status"
              icon={Tag}
              entries={statusDistribution}
              emptyMessage="Nenhum exemplar cadastrado ainda."
            />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
            Histórico de aquisições
          </p>
          {/* Etapa 13.2: legenda discreta — distingue esta seção (todas as
              compras já feitas) do "Investido na coleção" acima (só itens
              ativos). Sem alerta, sem cor de destaque, mesmo tom do resto
              da UI. */}
          <p className="text-xs text-text-secondary/80">
            Inclui compras de itens que posteriormente foram para a lixeira.
          </p>
        </div>
        {hasAcquisitionsError ? (
          <DashboardErrorState
            title="Não foi possível carregar suas aquisições"
            description="Ocorreu um problema ao carregar o histórico de compras."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                icon={ShoppingCart}
                label="Número de compras"
                value={String(numeroCompras)}
                description="Operações de aquisição"
              />
              <StatCard
                icon={Banknote}
                label="Ticket médio"
                value={ticketMedio === null ? '—' : currencyFormatter.format(ticketMedio)}
                description="Por operação de compra"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <MonthlySeriesChart
                title="Aquisições por mês"
                icon={CalendarRange}
                entries={monthlyAcquisitionValue}
                emptyMessage="Nenhuma aquisição registrada ainda."
                formatValue={(value) => compactCurrencyFormatter.format(value)}
              />
              <MonthlySeriesChart
                title="Exemplares adquiridos por mês"
                icon={PackagePlus}
                entries={monthlyAcquisitionQuantity}
                emptyMessage="Nenhum exemplar adquirido ainda."
                formatValue={(value) => quantityFormatter.format(value)}
              />
            </div>

            <AcquisitionsList acquisitions={recentAcquisitions} currencyFormatter={currencyFormatter} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
          Atividade recente
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="text-base font-semibold text-text-primary">Minha coleção</h2>
            {hasStatsError ? (
              <p className="mt-4 text-sm text-danger">Não foi possível carregar os dados da sua coleção.</p>
            ) : totalItems === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={PackageOpen}
                  title="Sua coleção ainda está vazia"
                  description="Comece cadastrando sua primeira moeda."
                  className="border-none px-0 py-6"
                  action={
                    <Link
                      href="/dashboard/collection"
                      className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
                    >
                      Adicionar primeira moeda
                    </Link>
                  }
                />
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm text-text-secondary">
                  Você tem {totalItems} moeda{totalItems === 1 ? '' : 's'} catalogada
                  {totalItems === 1 ? '' : 's'} em {countryCount} país{countryCount === 1 ? '' : 'es'}.
                </p>
                <Link
                  href="/dashboard/collection"
                  className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface-hover px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  Ver coleção completa
                </Link>
              </>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-text-primary">Última aquisição</h2>
            {hasLastPurchaseError ? (
              <p className="mt-4 text-sm text-danger">Não foi possível carregar sua última aquisição.</p>
            ) : lastPurchase === null ? (
              <div className="mt-4">
                <EmptyState
                  icon={ShoppingBag}
                  title="Nenhuma aquisição registrada"
                  className="border-none px-0 py-6"
                />
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3.5">
                <div>
                  <p className="font-semibold text-text-primary">
                    {currencyFormatter.format(Number(lastPurchase.total_price))}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {lastPurchase.seller_name ?? 'Vendedor não informado'}
                  </p>
                </div>
                {lastPurchase.purchase_date && (
                  <p className="text-sm text-text-secondary">{formatDateOnly(lastPurchase.purchase_date)}</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  )
}
