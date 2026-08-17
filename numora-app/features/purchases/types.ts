/**
 * features/purchases/types.ts
 * Tipagens de domínio da feature de compras (transações de aquisição).
 */

/** Etapa 14.3 — ver `check_purchase_confirmed_immutable` (banco): `confirmed` trava os campos financeiros contra edição. Nenhuma UI leva uma purchase a `confirmed`/`cancelled` ainda — todo dado hoje nasce e permanece `draft`. */
export type PurchaseStatus = 'draft' | 'confirmed' | 'cancelled'

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
  status: PurchaseStatus
  /**
   * Etapa 14.1-R2 §11 — detalhamento OPCIONAL de `totalPrice`, nunca um
   * substituto. `null` quando não detalhado (100% do dado hoje) — o
   * rateio por exemplar trata `totalPrice` inteiro como `itemsAmount`
   * nesse caso. Nenhuma UI escreve estes campos ainda (Etapa 14.3).
   */
  itemsAmount: number | null
  shippingAmount: number | null
  insuranceAmount: number | null
  taxAmount: number | null
  discountAmount: number | null
  confirmedAt: string | null
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
