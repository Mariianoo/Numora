/**
 * features/purchases/repositories/purchases.repository.ts
 * Infrastructure layer da feature de compras (PROJECT_RULES.md §4.2) —
 * única camada que conhece o nome da tabela `purchases` e de suas
 * colunas. Associa toda escrita ao usuário logado obtido da sessão
 * (`supabase.auth.getUser()`), nunca recebendo `user_id` de fora — a UI
 * não escolhe o dono do registro.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Purchase, PurchaseInput } from '@/features/purchases/types'

export interface PurchasesRepository {
  list(): Promise<Purchase[]>
  get(id: string): Promise<Purchase | null>
  create(input: PurchaseInput): Promise<Purchase>
  update(id: string, input: PurchaseInput): Promise<Purchase>
  remove(id: string): Promise<void>
}

interface PurchaseRow {
  id: string
  user_id: string
  total_price: number
  currency: string
  purchase_date: string | null
  seller_name: string | null
  seller_contact: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

function toPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    userId: row.user_id,
    totalPrice: row.total_price,
    currency: row.currency,
    purchaseDate: row.purchase_date,
    sellerName: row.seller_name,
    sellerContact: row.seller_contact,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSupabasePurchasesRepository(): PurchasesRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async list() {
      const { data, error } = await supabase
        .from('purchases')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`[PurchasesRepository] Falha ao listar compras: ${error.message}`)
      }

      return (data as PurchaseRow[]).map(toPurchase)
    },

    async get(id) {
      const { data, error } = await supabase.from('purchases').select('*').eq('id', id).maybeSingle()

      if (error) {
        throw new Error(`[PurchasesRepository] Falha ao buscar compra: ${error.message}`)
      }

      return data ? toPurchase(data as PurchaseRow) : null
    },

    async create(input) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[PurchasesRepository] Nenhum usuário logado para associar a compra.')
      }

      const { data, error } = await supabase
        .from('purchases')
        .insert({
          user_id: user.id,
          total_price: input.totalPrice,
          purchase_date: input.purchaseDate,
          seller_name: input.sellerName,
          seller_contact: input.sellerContact,
          notes: input.notes,
        })
        .select('*')
        .single()

      if (error) {
        throw new Error(`[PurchasesRepository] Falha ao registrar compra: ${error.message}`)
      }

      return toPurchase(data as PurchaseRow)
    },

    async update(id, input) {
      const { data, error } = await supabase
        .from('purchases')
        .update({
          total_price: input.totalPrice,
          purchase_date: input.purchaseDate,
          seller_name: input.sellerName,
          seller_contact: input.sellerContact,
          notes: input.notes,
        })
        .eq('id', id)
        .select('*')
        .single()

      if (error) {
        throw new Error(`[PurchasesRepository] Falha ao atualizar compra: ${error.message}`)
      }

      return toPurchase(data as PurchaseRow)
    },

    async remove(id) {
      const { error } = await supabase.from('purchases').delete().eq('id', id)

      if (error) {
        throw new Error(`[PurchasesRepository] Falha ao excluir compra: ${error.message}`)
      }
    },
  }
}
