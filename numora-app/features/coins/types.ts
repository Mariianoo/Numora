/**
 * features/coins/types.ts
 * Tipagens de domínio da feature de coleção de moedas.
 */

export interface Coin {
  id: string
  userId: string
  country: string
  year: number | null
  value: number | null
  description: string | null
  imageUrl: string | null
  pricePaid: number | null
  createdAt: string
}

/**
 * Dados do formulário "Adicionar moeda". `userId` não entra aqui — quem
 * associa a moeda ao usuário logado é o repositório, não a UI.
 */
export interface NewCoinInput {
  country: string
  year: number | null
  value: number | null
  description: string | null
  pricePaid: number | null
}
