/**
 * app/dashboard/page.tsx
 * Página protegida (sem estilização avançada). O proxy já bloqueia
 * acesso sem sessão, mas a página também verifica a sessão via supabase
 * server client — segunda camada de defesa, não depende só do proxy.
 *
 * Estatísticas com dado real (Etapa de integração): esta é uma página
 * Server Component, que usa o client Supabase de servidor diretamente
 * (mesmo padrão já existente aqui para obter `user`) — não passa pelos
 * repositories de features/collection e features/purchases, que são
 * client-side (usam o client de browser) e servem os componentes
 * interativos de /dashboard/collection.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/features/auth/components/LogoutButton'

interface CollectionItemStatsRow {
  quantity: number
  country_code: string | null
}

interface PurchaseStatsRow {
  total_price: number
}

interface LastPurchaseRow {
  total_price: number
  seller_name: string | null
  purchase_date: string | null
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [itemsResult, purchasesResult, lastPurchaseResult] = await Promise.all([
    supabase.from('collection_items').select('quantity, country_code'),
    supabase.from('purchases').select('total_price'),
    supabase
      .from('purchases')
      .select('total_price, seller_name, purchase_date')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const items = (itemsResult.data ?? []) as CollectionItemStatsRow[]
  const purchases = (purchasesResult.data ?? []) as PurchaseStatsRow[]
  const lastPurchase = lastPurchaseResult.data as LastPurchaseRow | null

  const totalItems = items.length
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)
  const totalInvested = purchases.reduce((sum, purchase) => sum + Number(purchase.total_price), 0)
  const countryCount = new Set(
    items.map((item) => item.country_code).filter((code): code is string => code !== null),
  ).size

  return (
    <div>
      <div className="flex items-center justify-between">
        <p>Dashboard</p>
        <LogoutButton />
      </div>
      <p>Logado como: {user.email}</p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="border p-3">
          <p className="text-sm">Itens na coleção</p>
          <p className="text-xl font-semibold">{totalItems}</p>
        </div>
        <div className="border p-3">
          <p className="text-sm">Total de unidades</p>
          <p className="text-xl font-semibold">{totalUnits}</p>
        </div>
        <div className="border p-3">
          <p className="text-sm">Países</p>
          <p className="text-xl font-semibold">{countryCount}</p>
        </div>
        <div className="border p-3">
          <p className="text-sm">Total investido</p>
          <p className="text-xl font-semibold">R$ {totalInvested.toFixed(2)}</p>
        </div>
        <div className="border p-3 sm:col-span-2">
          <p className="text-sm">Última aquisição</p>
          <p className="text-xl font-semibold">
            {lastPurchase
              ? `R$ ${Number(lastPurchase.total_price).toFixed(2)}${lastPurchase.seller_name ? ` — ${lastPurchase.seller_name}` : ''}`
              : '—'}
          </p>
        </div>
      </div>

      <p className="mt-6">
        <Link href="/dashboard/collection">Minha Coleção</Link>
      </p>
    </div>
  )
}
