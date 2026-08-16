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
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Coins, Layers, Globe2, Wallet, ShoppingBag, PackageOpen } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { computeCollectionStats, type CollectionItemStatsRow, type PurchaseStatsRow } from '@/lib/stats/collection-stats'
import { formatDateOnly } from '@/lib/format/date'
import { DashboardErrorState } from './DashboardErrorState'

interface LastPurchaseRow {
  total_price: number
  seller_name: string | null
  purchase_date: string | null
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

  const [itemsResult, purchasesResult, lastPurchaseResult, profileResult] = await Promise.all([
    supabase.from('collection_items').select('quantity, country_code, metal_code').is('deleted_at', null),
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
    supabase.from('profiles').select('name').eq('id', user.id).maybeSingle(),
  ])

  // Etapa 12.4: uma falha de query NUNCA deve virar silenciosamente "0
  // moedas"/"coleção vazia" — a auditoria encontrou exatamente esse
  // mascaramento aqui (nenhum dos 4 resultados tinha `.error` checado).
  // Cada bloco (resumo/coleção vs. última aquisição) falha de forma
  // independente, preservando os que carregaram com sucesso.
  const hasStatsError = Boolean(itemsResult.error || purchasesResult.error)
  const hasLastPurchaseError = Boolean(lastPurchaseResult.error)

  const items = (itemsResult.data ?? []) as CollectionItemStatsRow[]
  const purchases = (purchasesResult.data ?? []) as PurchaseStatsRow[]
  const lastPurchase = lastPurchaseResult.data as LastPurchaseRow | null
  const profileName = (profileResult.data as { name: string | null } | null)?.name

  const displayName = profileName?.trim() || user.email?.split('@')[0] || 'colecionador'

  const { totalItems, totalUnits, countryCount, totalInvested } = hasStatsError
    ? { totalItems: 0, totalUnits: 0, countryCount: 0, totalInvested: 0 }
    : computeCollectionStats(items, purchases)

  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
              label="Investido"
              value={currencyFormatter.format(totalInvested)}
              description="Valor total de aquisição"
            />
          </div>
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
