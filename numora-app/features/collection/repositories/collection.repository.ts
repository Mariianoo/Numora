/**
 * features/collection/repositories/collection.repository.ts
 * Infrastructure layer da feature de coleção (PROJECT_RULES.md §4.2) —
 * única camada que sabe o nome da tabela `collection_items` e de suas
 * colunas. Associa toda escrita ao usuário logado obtido da sessão,
 * nunca recebendo `user_id` de fora.
 *
 * Orquestra `PurchasesRepository` quando o item tem uma aquisição
 * vinculada (cria a compra antes do item, ou atualiza a compra existente
 * ao editar) — mas nunca conhece detalhes de UI de compras, só delega.
 * `collection_items.purchase_id` (Etapa 4) é quem representa essa
 * relação; não existe conceito de "lote" separado — vários itens podem
 * apontar para a mesma compra, isso não é modelado aqui.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createSupabasePurchasesRepository } from '@/features/purchases/repositories/purchases.repository'
import type { CollectionItem, CollectionItemInput } from '@/features/collection/types'

export interface CollectionRepository {
  list(): Promise<CollectionItem[]>
  get(id: string): Promise<CollectionItem | null>
  create(input: CollectionItemInput): Promise<CollectionItem>
  update(id: string, input: CollectionItemInput): Promise<CollectionItem>
  remove(id: string): Promise<void>
}

/**
 * `metals` precisa de desambiguação (`!metal_code`) porque
 * collection_items tem duas FKs para metals (metal_code e
 * secondary_metal_code) — sem isso o PostgREST não sabe qual relação
 * usar. As demais tabelas embutidas têm só uma FK cada, sem ambiguidade.
 */
const ITEM_SELECT = `
  *,
  countries ( name, flag_emoji ),
  metals!metal_code ( name ),
  grades ( label, scale ),
  purchases ( total_price, purchase_date, seller_name, notes )
`

interface CollectionItemRow {
  id: string
  user_id: string
  purchase_id: string | null
  country_code: string | null
  country_name: string | null
  year: number | null
  denomination: string | null
  mint: string | null
  metal_code: string | null
  secondary_metal_code: string | null
  gross_weight_g: number | null
  purity: number | null
  grade_id: string | null
  face_value: number | null
  quantity: number
  unit_cost_override: number | null
  description: string | null
  location: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
  countries: { name: string; flag_emoji: string | null } | null
  metals: { name: string } | null
  grades: { label: string; scale: string } | null
  purchases: {
    total_price: number
    purchase_date: string | null
    seller_name: string | null
    notes: string | null
  } | null
}

function toCollectionItem(row: CollectionItemRow): CollectionItem {
  return {
    id: row.id,
    userId: row.user_id,
    purchaseId: row.purchase_id,
    countryCode: row.country_code,
    countryName: row.country_name,
    year: row.year,
    denomination: row.denomination,
    mint: row.mint,
    metalCode: row.metal_code,
    secondaryMetalCode: row.secondary_metal_code,
    grossWeightG: row.gross_weight_g,
    purity: row.purity,
    gradeId: row.grade_id,
    faceValue: row.face_value,
    quantity: row.quantity,
    unitCostOverride: row.unit_cost_override,
    description: row.description,
    location: row.location,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    countryDisplayName: row.countries?.name ?? null,
    countryFlagEmoji: row.countries?.flag_emoji ?? null,
    metalName: row.metals?.name ?? null,
    gradeLabel: row.grades?.label ?? null,
    gradeScale: row.grades?.scale ?? null,
    purchase: row.purchases
      ? {
          totalPrice: row.purchases.total_price,
          purchaseDate: row.purchases.purchase_date,
          sellerName: row.purchases.seller_name,
          notes: row.purchases.notes,
        }
      : null,
  }
}

export function createSupabaseCollectionRepository(): CollectionRepository {
  const supabase = getSupabaseBrowserClient()
  const purchasesRepository = createSupabasePurchasesRepository()

  async function get(id: string): Promise<CollectionItem | null> {
    const { data, error } = await supabase.from('collection_items').select(ITEM_SELECT).eq('id', id).maybeSingle()

    if (error) {
      throw new Error(`[CollectionRepository] Falha ao buscar item: ${error.message}`)
    }

    return data ? toCollectionItem(data as unknown as CollectionItemRow) : null
  }

  return {
    async list() {
      const { data, error } = await supabase
        .from('collection_items')
        .select(ITEM_SELECT)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao listar itens: ${error.message}`)
      }

      return (data as unknown as CollectionItemRow[]).map(toCollectionItem)
    },

    get,

    async create(input) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[CollectionRepository] Nenhum usuário logado para associar o item.')
      }

      let purchaseId: string | null = null
      if (input.purchase) {
        const purchase = await purchasesRepository.create(input.purchase)
        purchaseId = purchase.id
      }

      const { data, error } = await supabase
        .from('collection_items')
        .insert({
          user_id: user.id,
          purchase_id: purchaseId,
          country_code: input.countryCode,
          year: input.year,
          denomination: input.denomination,
          metal_code: input.metalCode,
          gross_weight_g: input.grossWeightG,
          purity: input.purity,
          grade_id: input.gradeId,
          face_value: input.faceValue,
          quantity: input.quantity,
        })
        .select(ITEM_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao adicionar item: ${error.message}`)
      }

      return toCollectionItem(data as unknown as CollectionItemRow)
    },

    async update(id, input) {
      const current = await get(id)
      if (!current) {
        throw new Error('[CollectionRepository] Item não encontrado.')
      }

      let purchaseId = current.purchaseId
      if (input.purchase) {
        if (purchaseId) {
          await purchasesRepository.update(purchaseId, input.purchase)
        } else {
          const purchase = await purchasesRepository.create(input.purchase)
          purchaseId = purchase.id
        }
      }

      const { data, error } = await supabase
        .from('collection_items')
        .update({
          purchase_id: purchaseId,
          country_code: input.countryCode,
          year: input.year,
          denomination: input.denomination,
          metal_code: input.metalCode,
          gross_weight_g: input.grossWeightG,
          purity: input.purity,
          grade_id: input.gradeId,
          face_value: input.faceValue,
          quantity: input.quantity,
        })
        .eq('id', id)
        .select(ITEM_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao atualizar item: ${error.message}`)
      }

      return toCollectionItem(data as unknown as CollectionItemRow)
    },

    async remove(id) {
      const { error } = await supabase.from('collection_items').delete().eq('id', id)

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao excluir item: ${error.message}`)
      }
    },
  }
}
