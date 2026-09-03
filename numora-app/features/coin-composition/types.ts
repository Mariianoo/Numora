/**
 * features/coin-composition/types.ts
 * Tipagens de domínio da composição metálica de uma moeda (Fundação de
 * composição — Etapa 1: `collection_item_coin_parts` +
 * `collection_item_coin_part_components`; Etapa 2: RPC
 * `set_collection_item_composition`).
 *
 * Feature separada de `features/collection` de propósito — mesmo padrão já
 * usado por `features/coin-images` (também um sub-domínio de
 * `collection_items`/`collection_units` com tabelas, regras e ciclo de vida
 * próprios, decoupled do repository principal de coleção).
 *
 * `collection_items.metal_code`/`secondary_metal_code`/`purity` continuam
 * existindo (compatibilidade) e são derivados/escritos EXCLUSIVAMENTE pela
 * RPC `set_collection_item_composition` a partir desta etapa — nenhum
 * método deste arquivo/repository escreve esses 3 campos diretamente (ver
 * `CoinCompositionRepository.setComposition`). `CollectionRepository.create()`/
 * `update()` ainda escrevem esses campos diretamente hoje (auditoria desta
 * etapa) — migrar esses dois pontos é trabalho de uma etapa futura, fora
 * do escopo aqui.
 *
 * `percentage = null` SEMPRE significa "proporção não informada/
 * desconhecida" — nunca um valor numérico implícito, nem mesmo 100%. Se a
 * proporção de um componente único é conhecida como sendo 100% da parte,
 * o valor gravado é `100` explicitamente (nunca `null`). Ver comentário da
 * migration `20260902190000_set_collection_item_composition.sql`.
 */

export type CoinPartType = 'body' | 'core' | 'ring' | 'plating'

export interface CoinPartComponent {
  id: string
  partId: string
  metalCode: string
  /** `null` = proporção não informada/desconhecida — nunca 100% implícito. */
  percentage: number | null
  sortOrder: number
}

export interface CoinPart {
  id: string
  collectionItemId: string
  part: CoinPartType
  sortOrder: number
  components: CoinPartComponent[]
}

export interface CoinCompositionLegacy {
  metalCode: string | null
  secondaryMetalCode: string | null
  purity: number | null
}

export interface CoinComposition {
  collectionItemId: string
  /**
   * Array vazio = composição desconhecida (mesmo significado de
   * `legacy.metalCode === null` num item nunca detalhado). Quando o item
   * é legado (nunca passou pela RPC) e tem `metal_code`/`purity`
   * preenchidos, este array é SINTETIZADO em memória pelo repository
   * (`getComposition`) — nunca persistido no banco pelo fallback.
   */
  parts: CoinPart[]
  legacy: CoinCompositionLegacy
}

/** Componente de uma parte, no formato aceito pela RPC (`p_parts`). */
export interface CoinPartComponentInput {
  metalCode: string
  /** `null` = proporção não informada/desconhecida — nunca envie `100` "por padrão". */
  percentage: number | null
  /** Opcional — se omitido, a RPC usa a posição do componente no array da parte. */
  sortOrder?: number
}

/** Uma parte física, no formato aceito pela RPC (`p_parts`). */
export interface SetCoinCompositionPartInput {
  part: CoinPartType
  /** Opcional — se omitido, a RPC usa a posição da parte no array. */
  sortOrder?: number
  components: CoinPartComponentInput[]
}

/**
 * Payload de `CoinCompositionRepository.setComposition` — espelha
 * exatamente `p_parts` da RPC `set_collection_item_composition`. Array
 * vazio (`[]`) = "composição desconhecida": limpa toda a composição
 * existente e zera os 3 campos legados. A RPC é quem valida todas as
 * regras de negócio (body×core/ring, soma de percentuais, metal
 * duplicado/inexistente etc.) — este tipo só descreve o formato do
 * payload, nunca duplica essas regras em TypeScript.
 */
export type SetCoinCompositionInput = SetCoinCompositionPartInput[]
