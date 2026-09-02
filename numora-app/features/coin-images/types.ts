/**
 * features/coin-images/types.ts
 * Tipagens de domínio das fotos de um exemplar físico (coin_images).
 * Cada `collection_unit` pode ter no máximo 3 imagens — uma por `kind`
 * (frente/verso/borda) — nunca mais de uma do mesmo tipo (UNIQUE no
 * banco). `edge` é sempre opcional; `front`/`back` também não são
 * obrigatórias nesta versão.
 */

/** Bucket PÚBLICO das derivações com marca d'água (Fundação de imagens) — nunca a imagem original, que continua só em `coin-images` (privado). */
export const PUBLIC_COIN_IMAGE_BUCKET = 'coin-images-public'

export type CoinImageKind = 'front' | 'back' | 'edge'

export const COIN_IMAGE_KIND_LABELS: Record<CoinImageKind, string> = {
  front: 'Frente',
  back: 'Verso',
  edge: 'Borda',
}

export const COIN_IMAGE_KINDS: CoinImageKind[] = ['front', 'back', 'edge']

export interface CoinImage {
  id: string
  collectionUnitId: string
  kind: CoinImageKind
  /** Path relativo no bucket (`{user_id}/{collection_unit_id}/{kind}.webp`) — nunca uma URL. */
  storagePath: string
  width: number
  height: number
  /** Bytes. */
  fileSize: number
  mimeType: string
  createdAt: string
  updatedAt: string
}

/** Já processada no navegador (redimensionada, convertida e comprimida) — pronta para upload. */
export interface CoinImageUpload {
  kind: CoinImageKind
  blob: Blob
  width: number
  height: number
}
