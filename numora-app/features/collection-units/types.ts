/**
 * features/collection-units/types.ts
 * Tipagens de domínio dos exemplares físicos (collection_units) de uma
 * moeda (collection_items). Um `collection_item` identifica a emissão
 * (país, ano, denominação, metal...); cada `collection_unit` identifica
 * um exemplar físico específico que o colecionador possui — com sua
 * própria conservação, avaliação pessoal e status.
 */

/**
 * Valores técnicos persistidos no banco (`collection_units.status`,
 * CHECK constraint). A UI nunca deve exibir esses valores brutos — usar
 * sempre `COLLECTION_UNIT_STATUS_LABELS` para o rótulo em português.
 */
export type CollectionUnitStatus = 'in_collection' | 'for_trade' | 'for_sale' | 'reserved' | 'sold' | 'traded'

export const COLLECTION_UNIT_STATUS_LABELS: Record<CollectionUnitStatus, string> = {
  in_collection: 'Na coleção',
  for_trade: 'Disponível para troca',
  for_sale: 'Disponível para venda',
  reserved: 'Reservada',
  sold: 'Vendida',
  traded: 'Trocada',
}

export const COLLECTION_UNIT_STATUS_OPTIONS: CollectionUnitStatus[] = [
  'in_collection',
  'for_trade',
  'for_sale',
  'reserved',
  'sold',
  'traded',
]

export interface CollectionUnit {
  id: string
  collectionItemId: string
  /** Conservação deste exemplar específico — nunca da emissão como um todo. */
  gradeId: string | null
  gradeLabel: string | null
  gradeScale: string | null
  status: CollectionUnitStatus
  /**
   * Avaliação pessoal do colecionador (1 a 5 estrelas), independente da
   * conservação numismática. `null` = ainda não avaliado (não é o mesmo
   * que "0 estrelas").
   */
  rating: number | null
  createdAt: string
  updatedAt: string
}

export interface CollectionUnitInput {
  gradeId: string | null
  status: CollectionUnitStatus
  rating: number | null
}
