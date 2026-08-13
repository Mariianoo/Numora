/**
 * features/collection/types.ts
 * Tipagens de domínio da feature de coleção (collection_items) e das
 * tabelas de referência que a alimentam (countries, metals, grades).
 */
import type { PurchaseInput } from '@/features/purchases/types'

export interface CollectionItem {
  id: string
  userId: string
  purchaseId: string | null
  countryCode: string | null
  countryName: string | null
  year: number | null
  denomination: string | null
  mint: string | null
  metalCode: string | null
  secondaryMetalCode: string | null
  grossWeightG: number | null
  purity: number | null
  gradeId: string | null
  faceValue: number | null
  quantity: number
  unitCostOverride: number | null
  description: string | null
  location: string | null
  tags: string[] | null
  createdAt: string
  updatedAt: string
  /** Resolvidos via join — nomes de exibição, não colunas próprias. */
  countryDisplayName: string | null
  countryFlagEmoji: string | null
  metalName: string | null
  gradeLabel: string | null
  gradeScale: string | null
  /** Dados da compra vinculada (purchases), quando existir. */
  purchase: {
    totalPrice: number
    purchaseDate: string | null
    sellerName: string | null
    notes: string | null
  } | null
}

/**
 * Dados do formulário "Adicionar/Editar moeda" — só os campos expostos na
 * primeira versão da tela (país, ano, denominação, metal, peso, pureza,
 * grau, valor de face, quantidade). Os demais campos de collection_items
 * (mint, secondary_metal_code, unit_cost_override, description, location,
 * tags) já existem no banco (Etapa 4) mas não têm UI ainda — permanecem
 * null nesta versão, sem perda de dado futuro.
 *
 * `purchase` é opcional: se preenchido, o repositório cria (ou atualiza,
 * se o item já tiver uma) a compra vinculada; se null, o item não
 * tem/mantém aquisição registrada. Nunca inclui `purchaseId` nem
 * `userId` — quem resolve isso é o repositório, nunca a UI.
 */
export interface CollectionItemInput {
  countryCode: string | null
  year: number | null
  denomination: string | null
  metalCode: string | null
  grossWeightG: number | null
  purity: number | null
  gradeId: string | null
  faceValue: number | null
  quantity: number
  purchase: PurchaseInput | null
}

export interface Country {
  code: string
  name: string
  flagEmoji: string | null
}

export interface Metal {
  code: string
  name: string
  isPrecious: boolean
}

export interface Grade {
  id: string
  scale: string
  code: string
  label: string
  sortOrder: number
}
