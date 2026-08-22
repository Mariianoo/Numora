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
 *
 * Etapa 15.2 (migração das leituras financeiras — auditoria Etapa 15.1):
 * as 4 queries antigas de `purchases`/`collection_items!inner` enxergavam
 * só a PRIMEIRA compra de cada item (via `collection_items.purchase_id`,
 * campo legado 1-para-1) — uma emissão com 2+ compras ficava com
 * "Investido"/"Número de compras"/"Ticket médio"/"Aquisições" mostrando
 * só a primeira. A fonte de verdade por exemplar (`collection_units.
 * purchase_id`/`unit_cost`, Etapa 14.3) substitui essas queries por 2
 * consultas a `collection_units` — uma para o escopo "Resumo" (só
 * exemplares de itens ativos: Investido, Valor médio, Número de compras,
 * Ticket médio, Última aquisição) e outra para o escopo "Histórico"
 * (preserva a regra da Etapa 13.3: inclui exemplares de itens na lixeira,
 * exclui só compras 100% órfãs). `AcquisitionPurchaseRow`/
 * `selectRecentAcquisitions`/`computeMonthlyAcquisitionValue`/
 * `computeMonthlyAcquisitionQuantity`/`computeTicketMedio` continuam
 * exatamente como antes — a nova `groupUnitsByPurchase` (lib/stats)
 * reconstrói o mesmo formato "uma linha por compra" a partir de
 * exemplares, então essas funções não precisaram mudar. Distribuições
 * (país/metal/conservação/status) inalteradas — seguem 100% de
 * `collection_items`/`collection_units`, sem relação com `purchases`.
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
  groupUnitsByPurchase,
  type CollectionItemStatsRow,
  type CollectionItemDistributionRow,
  type CollectionUnitDistributionRow,
  type AcquisitionUnitRow,
} from '@/lib/stats/collection-stats'
import { formatDateOnly } from '@/lib/format/date'
import { DashboardViewTracker } from '@/components/analytics/DashboardViewTracker'
import { DashboardErrorState } from './DashboardErrorState'
import { DistributionCard } from './DistributionCard'
import { AcquisitionsList } from './AcquisitionsList'
import { MonthlySeriesChart } from './MonthlySeriesChart'

interface DashboardItemRow {
  quantity: number
  country_code: string | null
  metal_code: string | null
  countries: { name: string; flag_emoji: string | null } | null
  metals: { name: string } | null
  collection_units: { status: string; grade_id: string | null; grades: { label: string } | null }[]
}

/**
 * Etapa 15.2 — 1 linha por exemplar ATIVO (item não excluído/lixeira),
 * usada para Investido/Valor médio/Número de compras/Ticket médio/Última
 * aquisição. `purchase_id`/`purchases` ficam `null` quando o exemplar não
 * tem compra vinculada (cost_type unknown/gift/trade) — `unit_cost`
 * também é sempre `null` nesse caso, então não altera a soma de
 * investido; só é excluído do agrupamento por compra (`groupUnitsByPurchase`,
 * que exige `purchase_id` não-nulo).
 */
interface DashboardActiveUnitRow {
  unit_cost: number | null
  purchase_id: string | null
  collection_item_id: string
  collection_items: { id: string; denomination: string; deleted_at: string | null }
  purchases: {
    id: string
    total_price: number
    purchase_date: string | null
    seller_name: string | null
    created_at: string
  } | null
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

  const [itemsResult, activeUnitsResult, historyUnitsResult, profileResult] = await Promise.all([
    // Etapa 13.1: embeds de `countries`/`metals`/`collection_units(grades)`
    // adicionados para as distribuições — mesma query única de sempre,
    // sem N+1 (PostgREST resolve os embeds no próprio Postgres).
    supabase
      .from('collection_items')
      .select(
        'quantity, country_code, metal_code, countries ( name, flag_emoji ), metals!metal_code ( name ), collection_units ( status, grade_id, grades ( label ) )',
      )
      .is('deleted_at', null),
    // Etapa 15.2 — escopo "Resumo": só exemplares de itens ATIVOS
    // (`collection_items!inner` + filtro = EXISTS, mesma regra de sempre
    // do resumo). Serve Investido (soma de `unit_cost`), Valor médio,
    // Número de compras/Ticket médio (compras distintas destes
    // exemplares) e Última aquisição (a mais recente entre elas) — as 4
    // métricas de uma vez só, sem N+1: cada exemplar já traz seu item e
    // sua compra aninhados na mesma viagem ao banco.
    supabase
      .from('collection_units')
      .select(
        'unit_cost, purchase_id, collection_item_id, collection_items!inner ( id, denomination, deleted_at ), purchases ( id, total_price, purchase_date, seller_name, created_at )',
      )
      .is('collection_items.deleted_at', null),
    // Etapa 15.2 — escopo "Histórico": preserva a regra da Etapa 13.3
    // (`!inner` SEM filtro de `deleted_at` = "existe pelo menos 1 exemplar",
    // ativo OU na lixeira), agora a nível de EXEMPLAR em vez de item. Uma
    // compra sem nenhum `collection_unit` restante (todos os itens
    // excluídos definitivamente) simplesmente não aparece aqui — sem
    // precisar de lógica extra de exclusão (auditoria Etapa 13.3, Casos
    // A/E). `.not('purchase_id', 'is', null)` exclui só exemplares sem
    // compra vinculada (não representam uma aquisição a listar).
    supabase
      .from('collection_units')
      .select(
        'purchase_id, collection_item_id, collection_items!inner ( id, denomination, deleted_at ), purchases!inner ( id, total_price, purchase_date, seller_name, created_at )',
      )
      .not('purchase_id', 'is', null),
    supabase.from('profiles').select('name').eq('id', user.id).maybeSingle(),
  ])

  // Etapa 12.4: uma falha de query NUNCA deve virar silenciosamente "0
  // moedas"/"coleção vazia" — a auditoria encontrou exatamente esse
  // mascaramento aqui (nenhum dos 4 resultados tinha `.error` checado).
  // Cada bloco (resumo/coleção vs. última aquisição) falha de forma
  // independente, preservando os que carregaram com sucesso.
  //
  // Etapa 15.2: a seção "Histórico de aquisições" (StatCards + gráficos +
  // lista) mostra um único estado de erro (nunca dado parcialmente
  // incorreto) mesmo dependendo de 2 queries agora (`activeUnitsResult`
  // para Número de compras/Ticket médio, `historyUnitsResult` para
  // Aquisições recentes/gráficos mensais) — se qualquer uma falhar, a
  // seção inteira mostra erro.
  const hasStatsError = Boolean(itemsResult.error || activeUnitsResult.error)
  const hasLastPurchaseError = Boolean(activeUnitsResult.error)
  const hasAcquisitionsError = Boolean(activeUnitsResult.error || historyUnitsResult.error)

  const dashboardItems = (itemsResult.data ?? []) as unknown as DashboardItemRow[]
  const items = dashboardItems as CollectionItemStatsRow[]
  const activeUnits = (activeUnitsResult.data ?? []) as unknown as DashboardActiveUnitRow[]
  const historyUnits = (historyUnitsResult.data ?? []) as unknown as AcquisitionUnitRow[]
  const profileName = (profileResult.data as { name: string | null } | null)?.name

  const displayName = profileName?.trim() || user.email?.split('@')[0] || 'colecionador'

  // Etapa 15.2: `totalItems`/`totalUnits`/`countryCount` continuam vindo
  // de `collection_items` (inalterado). `computeCollectionStats` também
  // devolve `totalInvested` somando `purchases.total_price` — cálculo que
  // o Perfil (`ProfileRepository.getOwnStats`) ainda usa sem alteração,
  // mas que tem a mesma limitação que motivou esta etapa (só enxerga a
  // 1ª compra de cada item). O Dashboard passa `[]` no lugar de
  // `purchases` aqui — não precisa mais desse campo, porque calcula
  // `totalInvested` abaixo a partir de `collection_units.unit_cost`.
  const { totalItems, totalUnits, countryCount } = computeCollectionStats(items, [])

  const totalInvested = hasStatsError ? 0 : activeUnits.reduce((sum, unit) => sum + (unit.unit_cost ?? 0), 0)
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

  // Etapa 15.2: exemplares ativos COM compra vinculada, agrupados de volta
  // em "uma linha por compra" — fonte de Número de compras/Ticket
  // médio/Última aquisição (escopo "Resumo", só itens ativos).
  const activeAcquisitionRows = activeUnits.filter(
    (unit) => unit.purchase_id !== null && unit.purchases !== null,
  ) as unknown as AcquisitionUnitRow[]
  const activePurchases = groupUnitsByPurchase(activeAcquisitionRows)

  // Etapa 13.2/15.2: número de compras = número de OPERAÇÕES distintas
  // (nunca a soma de exemplares) — uma compra com vários exemplares
  // continua contando 1. Fonte agora é `collection_units.purchase_id`
  // (não mais `collection_items.purchase_id`), então uma emissão com 2+
  // compras conta as 2, não só a primeira.
  const numeroCompras = hasAcquisitionsError ? 0 : activePurchases.length
  const ticketMedio = hasAcquisitionsError ? null : computeTicketMedio(activePurchases)
  const lastAcquisition = hasLastPurchaseError ? null : (selectRecentAcquisitions(activePurchases, 1)[0] ?? null)

  // Etapa 15.2: escopo "Histórico" — inclui exemplares de itens na
  // lixeira (regra da Etapa 13.3, preservada), fonte separada da do
  // "Resumo" acima.
  const historyPurchases = groupUnitsByPurchase(historyUnits)
  const recentAcquisitions = hasAcquisitionsError ? [] : selectRecentAcquisitions(historyPurchases, 5)
  const monthlyAcquisitionValue = hasAcquisitionsError ? [] : computeMonthlyAcquisitionValue(historyPurchases)
  const monthlyAcquisitionQuantity = hasAcquisitionsError ? [] : computeMonthlyAcquisitionQuantity(historyPurchases)

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
      <DashboardViewTracker />
      <PageHeader title={`${getGreeting()}, ${displayName}`} description="Veja como está sua coleção." />

      {!hasStatsError && totalItems === 0 ? (
        // Etapa 15.10.13: usuário sem coleção — prioriza ativação (uma
        // única ação visível, sem scroll) em vez de métricas/gráficos/
        // histórico zerados. `!hasStatsError` preserva a proteção da
        // Etapa 12.4: uma falha de query nunca deve parecer "coleção
        // vazia".
        <Card className="p-8">
          <EmptyState
            icon={PackageOpen}
            title="Comece a organizar sua coleção"
            description="Adicione sua primeira moeda para começar a acompanhar sua coleção."
            action={
              <Link
                href="/dashboard/collection"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
              >
                Adicionar minha primeira moeda
              </Link>
            }
          />
        </Card>
      ) : (
        <>
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
            ) : lastAcquisition === null ? (
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
                    {currencyFormatter.format(lastAcquisition.totalPrice)}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {lastAcquisition.sellerName ?? 'Vendedor não informado'}
                  </p>
                </div>
                {lastAcquisition.purchaseDate && (
                  <p className="text-sm text-text-secondary">{formatDateOnly(lastAcquisition.purchaseDate)}</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>
        </>
      )}
    </div>
  )
}
