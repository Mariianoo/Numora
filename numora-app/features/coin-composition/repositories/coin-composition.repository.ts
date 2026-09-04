/**
 * features/coin-composition/repositories/coin-composition.repository.ts
 * Infrastructure layer da composição metálica (Fundação de composição —
 * Etapa 3A). Única camada que sabe o nome das tabelas
 * `collection_item_coin_parts`/`collection_item_coin_part_components` e o
 * nome da RPC `set_collection_item_composition`.
 *
 * ESCRITA: `setComposition` SEMPRE chama a RPC — nunca faz INSERT/UPDATE
 * direto nessas duas tabelas, nem escreve
 * `collection_items.metal_code`/`secondary_metal_code`/`purity`
 * diretamente. A RPC (`SECURITY INVOKER`, ver migration
 * `20260902190000_set_collection_item_composition.sql`) é o único
 * escritor desses 5 campos a partir desta etapa — nenhum service role,
 * nenhuma Admin API, roda com a sessão normal do usuário (RLS de verdade).
 *
 * LEITURA: `getComposition` faz UMA query só (embed Supabase, mesmo padrão
 * já usado por `CollectionRepository` para `collection_units`/`coin_images`)
 * trazendo `collection_items` + `collection_item_coin_parts` +
 * `collection_item_coin_part_components` de uma vez — sem N+1.
 *
 * FALLBACK LEGADO: itens que nunca passaram pela RPC não têm nenhuma linha
 * em `collection_item_coin_parts`. Nesse caso, `getComposition` sintetiza
 * uma `CoinComposition` em memória a partir de
 * `metal_code`/`secondary_metal_code`/`purity` — nunca grava nada no banco
 * ao fazer isso (ver `synthesizeLegacyComposition`).
 *
 * `synthesizeLegacyComposition`/`parseCompositionResponse` vivem em
 * `../composition-mapping` (Etapa "F2 — Closed Beta Test Suite") — funções
 * puras, sem client Supabase, extraídas daqui para serem testáveis
 * isoladamente. Nenhuma mudança de comportamento, só de localização.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { parseCompositionResponse, synthesizeLegacyComposition } from '@/features/coin-composition/composition-mapping'
import type {
  CoinComposition,
  CoinPart,
  CoinPartComponent,
  CoinPartType,
  SetCoinCompositionInput,
} from '@/features/coin-composition/types'

export const COMPOSITION_OWNERSHIP_ERROR_CODE = '42501'
export const COMPOSITION_INVALID_PAYLOAD_ERROR_CODE = '22023'
export const COMPOSITION_UNKNOWN_METAL_ERROR_CODE = '23503'
export const COMPOSITION_DUPLICATE_METAL_ERROR_CODE = '23505'

export interface CoinCompositionRepository {
  /**
   * Se o item já tem composição na estrutura nova, retorna ela. Se não
   * (item legado ou nunca detalhado), sintetiza uma composição compatível
   * a partir dos campos legados — sem gravar nada no banco. Lança erro se
   * o item não existir ou não pertencer ao usuário logado (RLS).
   */
  getComposition(collectionItemId: string): Promise<CoinComposition>
  /**
   * Único método de escrita — sempre via RPC `set_collection_item_composition`.
   * `parts: []` limpa a composição inteira e zera os 3 campos legados
   * ("composição desconhecida"). Erros da RPC (owner/payload/metal) são
   * propagados com o `code` original preservado como propriedade do
   * `Error` lançado — nunca mascarados numa mensagem genérica.
   */
  setComposition(collectionItemId: string, parts: SetCoinCompositionInput): Promise<CoinComposition>
}

// ----------------------------------------------------------------------------
// Linhas cruas da query de leitura (embed Supabase, snake_case).
// ----------------------------------------------------------------------------

interface PartComponentRow {
  id: string
  metal_code: string
  percentage: number | null
  sort_order: number
}

interface PartRow {
  id: string
  part: CoinPartType
  sort_order: number
  collection_item_coin_part_components: PartComponentRow[]
}

interface CollectionItemCompositionRow {
  id: string
  metal_code: string | null
  secondary_metal_code: string | null
  purity: number | null
  collection_item_coin_parts: PartRow[]
}

const COMPOSITION_SELECT = `
  id, metal_code, secondary_metal_code, purity,
  collection_item_coin_parts (
    id, part, sort_order,
    collection_item_coin_part_components ( id, metal_code, percentage, sort_order )
  )
`

function toCoinPartComponent(row: PartComponentRow, partId: string): CoinPartComponent {
  return {
    id: row.id,
    partId,
    metalCode: row.metal_code,
    percentage: row.percentage,
    sortOrder: row.sort_order,
  }
}

function toCoinPart(row: PartRow, collectionItemId: string): CoinPart {
  return {
    id: row.id,
    collectionItemId,
    part: row.part,
    sortOrder: row.sort_order,
    components: row.collection_item_coin_part_components
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((component) => toCoinPartComponent(component, row.id)),
  }
}

/**
 * A RPC já produz mensagens específicas e em português para cada regra de
 * composição violada (ver `RAISE EXCEPTION` na migration) — este
 * mapeamento só acrescenta o prefixo padrão do projeto e preserva
 * `error.code` como propriedade do `Error` lançado, para quem chamar
 * poder distinguir 42501/22023/23503/23505 programaticamente sem
 * reparsear a mensagem. Nunca substitui a mensagem original por um texto
 * genérico (mesmo espírito de `mapAuthErrorMessage`, mas sem precisar de
 * um `switch` de tradução: as mensagens da RPC já são diretamente
 * apresentáveis).
 */
function toCompositionError(error: { code?: string; message: string }): Error {
  const err = new Error(`[CoinCompositionRepository] ${error.message}`)
  if (error.code) {
    Object.assign(err, { code: error.code })
  }
  return err
}

export function createSupabaseCoinCompositionRepository(): CoinCompositionRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async getComposition(collectionItemId) {
      const { data, error } = await supabase
        .from('collection_items')
        .select(COMPOSITION_SELECT)
        .eq('id', collectionItemId)
        .maybeSingle()

      if (error) {
        throw new Error(`[CoinCompositionRepository] Falha ao buscar composição: ${error.message}`)
      }

      if (!data) {
        throw new Error('[CoinCompositionRepository] Moeda não encontrada.')
      }

      const row = data as unknown as CollectionItemCompositionRow
      const parts = row.collection_item_coin_parts ?? []

      if (parts.length > 0) {
        return {
          collectionItemId: row.id,
          parts: parts
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((part) => toCoinPart(part, row.id)),
          legacy: {
            metalCode: row.metal_code,
            secondaryMetalCode: row.secondary_metal_code,
            purity: row.purity,
          },
        }
      }

      return synthesizeLegacyComposition(row)
    },

    async setComposition(collectionItemId, parts) {
      if (!collectionItemId) {
        throw new Error('[CoinCompositionRepository] collectionItemId é obrigatório.')
      }
      if (!Array.isArray(parts)) {
        throw new Error('[CoinCompositionRepository] parts precisa ser um array (pode ser vazio).')
      }

      // Só normaliza o formato do payload (posição -> sortOrder padrão) —
      // nenhuma regra de composição (body×core/ring, soma de percentuais,
      // metal duplicado/inexistente etc.) é replicada aqui: a RPC é a
      // única autoridade para essas regras.
      const payload = parts.map((part, partIndex) => ({
        part: part.part,
        sortOrder: part.sortOrder ?? partIndex,
        components: part.components.map((component, componentIndex) => ({
          metalCode: component.metalCode,
          percentage: component.percentage,
          sortOrder: component.sortOrder ?? componentIndex,
        })),
      }))

      const { data, error } = await supabase.rpc('set_collection_item_composition', {
        p_collection_item_id: collectionItemId,
        p_parts: payload,
      })

      if (error) {
        throw toCompositionError(error)
      }

      return parseCompositionResponse(data, collectionItemId)
    },
  }
}
