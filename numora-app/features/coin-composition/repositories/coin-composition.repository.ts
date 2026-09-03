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
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type {
  CoinComposition,
  CoinCompositionLegacy,
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
 * Sintetiza uma `CoinComposition` a partir dos campos legados — só em
 * memória, NUNCA grava nada no banco. Usada quando o item não tem
 * nenhuma linha em `collection_item_coin_parts` (nunca passou pela RPC).
 *
 * Caso 1 (monometálica — só `metal_code`): 1 parte `body` com 1
 * componente; `percentage = purity * 100` quando `purity` é conhecido,
 * `null` caso contrário — NUNCA vira `100` por padrão (ver auditoria: o
 * schema novo distingue "100% conhecido" de "proporção desconhecida",
 * e o legado nunca garantiu que ausência de dúvida = 100%).
 *
 * Caso 2 (bimetálica — `metal_code` + `secondary_metal_code`): 1 parte
 * `core` + 1 parte `ring`, cada uma com 1 componente e `percentage =
 * null` SEMPRE. AMBIGUIDADE VERIFICADA E DOCUMENTADA (ver relatório desta
 * etapa): o campo `purity` no formulário legado (`app/dashboard/collection/
 * page.tsx`) é um input único ("Pureza (%)") que nunca muda de rótulo ou
 * comportamento quando o usuário marca "Dois metais" — nada no código ou
 * nos comentários da migration original sugere que `purity` alguma vez
 * representou "fração de massa do núcleo" numa moeda bimetálica (o
 * significado numismático usual de "pureza" é o teor de metal nobre numa
 * liga, um conceito diferente de "proporção núcleo/anel"). Por isso este
 * fallback NUNCA deriva percentuais de `purity` para o caso bimetálico —
 * fazer isso seria inventar um dado que o modelo legado nunca garantiu.
 *
 * Caso 3 (nenhum dos dois preenchidos): composição desconhecida — `parts: []`.
 */
function synthesizeLegacyComposition(legacy: CollectionItemCompositionRow): CoinComposition {
  const collectionItemId = legacy.id
  const legacyOut: CoinCompositionLegacy = {
    metalCode: legacy.metal_code,
    secondaryMetalCode: legacy.secondary_metal_code,
    purity: legacy.purity,
  }

  if (legacy.metal_code === null && legacy.secondary_metal_code === null) {
    return { collectionItemId, parts: [], legacy: legacyOut }
  }

  if (legacy.metal_code !== null && legacy.secondary_metal_code !== null) {
    const corePartId = `legacy-core-${collectionItemId}`
    const ringPartId = `legacy-ring-${collectionItemId}`
    return {
      collectionItemId,
      legacy: legacyOut,
      parts: [
        {
          id: corePartId,
          collectionItemId,
          part: 'core',
          sortOrder: 0,
          components: [
            { id: `${corePartId}-0`, partId: corePartId, metalCode: legacy.metal_code, percentage: null, sortOrder: 0 },
          ],
        },
        {
          id: ringPartId,
          collectionItemId,
          part: 'ring',
          sortOrder: 1,
          components: [
            {
              id: `${ringPartId}-0`,
              partId: ringPartId,
              metalCode: legacy.secondary_metal_code,
              percentage: null,
              sortOrder: 0,
            },
          ],
        },
      ],
    }
  }

  // Só metal_code preenchido — Caso 1.
  const bodyPartId = `legacy-body-${collectionItemId}`
  const percentage = legacy.purity !== null ? legacy.purity * 100 : null
  return {
    collectionItemId,
    legacy: legacyOut,
    parts: [
      {
        id: bodyPartId,
        collectionItemId,
        part: 'body',
        sortOrder: 0,
        components: [
          {
            id: `${bodyPartId}-0`,
            partId: bodyPartId,
            metalCode: legacy.metal_code as string,
            percentage,
            sortOrder: 0,
          },
        ],
      },
    ],
  }
}

// ----------------------------------------------------------------------------
// Retorno da RPC (jsonb, já em camelCase — ver `jsonb_build_object` na
// migration). Validado minimamente antes de ser exposto ao resto da
// aplicação: uma resposta com formato inesperado nunca vira `[]`
// silenciosamente — lança erro explícito.
// ----------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCompositionResponse(raw: unknown, collectionItemId: string): CoinComposition {
  const invalid = () =>
    new Error(
      `[CoinCompositionRepository] Resposta inesperada da RPC set_collection_item_composition para o item ${collectionItemId}.`,
    )

  if (!isPlainObject(raw)) throw invalid()
  if (typeof raw.collectionItemId !== 'string') throw invalid()
  if (!Array.isArray(raw.parts)) throw invalid()
  if (!isPlainObject(raw.legacy)) throw invalid()

  const legacyRaw = raw.legacy
  if (
    !('metalCode' in legacyRaw) ||
    !('secondaryMetalCode' in legacyRaw) ||
    !('purity' in legacyRaw) ||
    (legacyRaw.metalCode !== null && typeof legacyRaw.metalCode !== 'string') ||
    (legacyRaw.secondaryMetalCode !== null && typeof legacyRaw.secondaryMetalCode !== 'string') ||
    (legacyRaw.purity !== null && typeof legacyRaw.purity !== 'number')
  ) {
    throw invalid()
  }

  const parts: CoinPart[] = raw.parts.map((partRaw): CoinPart => {
    if (
      !isPlainObject(partRaw) ||
      typeof partRaw.id !== 'string' ||
      typeof partRaw.part !== 'string' ||
      typeof partRaw.sortOrder !== 'number' ||
      !Array.isArray(partRaw.components)
    ) {
      throw invalid()
    }

    const partId = partRaw.id
    const components: CoinPartComponent[] = partRaw.components.map((componentRaw): CoinPartComponent => {
      if (
        !isPlainObject(componentRaw) ||
        typeof componentRaw.id !== 'string' ||
        typeof componentRaw.metalCode !== 'string' ||
        (componentRaw.percentage !== null && typeof componentRaw.percentage !== 'number') ||
        typeof componentRaw.sortOrder !== 'number'
      ) {
        throw invalid()
      }
      return {
        id: componentRaw.id,
        partId,
        metalCode: componentRaw.metalCode,
        percentage: componentRaw.percentage,
        sortOrder: componentRaw.sortOrder,
      }
    })

    return {
      id: partId,
      collectionItemId,
      part: partRaw.part as CoinPartType,
      sortOrder: partRaw.sortOrder,
      components,
    }
  })

  return {
    collectionItemId: raw.collectionItemId,
    parts,
    legacy: {
      metalCode: legacyRaw.metalCode as string | null,
      secondaryMetalCode: legacyRaw.secondaryMetalCode as string | null,
      purity: legacyRaw.purity as number | null,
    },
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
