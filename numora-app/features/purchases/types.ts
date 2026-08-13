/**
 * features/purchases/types.ts
 * Tipagens de domínio da feature de compras (transações de aquisição).
 */

export interface Purchase {
  id: string
  userId: string
  totalPrice: number
  currency: string
  purchaseDate: string | null
  sellerName: string | null
  sellerContact: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Dados do formulário de compra. `userId` não entra aqui — quem associa a
 * compra ao usuário logado é o repositório (via sessão), nunca a UI.
 */
export interface PurchaseInput {
  totalPrice: number
  purchaseDate: string | null
  sellerName: string | null
  sellerContact: string | null
  notes: string | null
}
