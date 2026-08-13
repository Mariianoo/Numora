/**
 * lib/stats/collection-stats.ts
 * Cálculo de estatísticas da coleção — extraído de app/dashboard/page.tsx
 * (Etapa 8.1) para ser reutilizado por app/dashboard/profile/page.tsx sem
 * duplicar a lógica nem alterar o comportamento do Dashboard.
 *
 * Função pura, sem dependência de Supabase — quem busca os dados decide a
 * origem (Dashboard: Server Component com client de servidor; Perfil:
 * ProfileRepository com client de browser). `total investido` soma
 * `purchases.total_price` diretamente (não deriva de collection_items),
 * de propósito: um item pode compartilhar `purchase_id` com outro
 * (aquisição em lote), então somar pelo lado de `collection_items`
 * contaria a mesma compra mais de uma vez.
 */

export interface CollectionItemStatsRow {
  quantity: number
  country_code: string | null
  metal_code: string | null
}

export interface PurchaseStatsRow {
  total_price: number
}

export interface CollectionStats {
  totalItems: number
  totalUnits: number
  countryCount: number
  metalCount: number
  totalInvested: number
}

export function computeCollectionStats(
  items: CollectionItemStatsRow[],
  purchases: PurchaseStatsRow[],
): CollectionStats {
  return {
    totalItems: items.length,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    countryCount: new Set(items.map((item) => item.country_code).filter((code): code is string => code !== null))
      .size,
    metalCount: new Set(items.map((item) => item.metal_code).filter((code): code is string => code !== null)).size,
    totalInvested: purchases.reduce((sum, purchase) => sum + Number(purchase.total_price), 0),
  }
}
