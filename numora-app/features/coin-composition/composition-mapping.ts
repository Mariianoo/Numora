/**
 * features/coin-composition/composition-mapping.ts
 * Funções puras de mapeamento de composição — extraídas de
 * `repositories/coin-composition.repository.ts` (Etapa "F2 — Closed Beta
 * Test Suite") para serem testáveis sem client Supabase, mesmo padrão já
 * usado por `features/collection/aggregate.ts`. Nenhuma mudança de
 * comportamento: só movidas, ainda chamadas exclusivamente pelo
 * repository.
 */
import type { CoinComposition, CoinCompositionLegacy, CoinPart, CoinPartComponent, CoinPartType } from './types'

/** Só as colunas que `synthesizeLegacyComposition` realmente lê — o repository passa a linha completa, que satisfaz este formato estruturalmente. */
export interface LegacyCompositionInput {
  id: string
  metal_code: string | null
  secondary_metal_code: string | null
  purity: number | null
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
export function synthesizeLegacyComposition(legacy: LegacyCompositionInput): CoinComposition {
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

export function parseCompositionResponse(raw: unknown, collectionItemId: string): CoinComposition {
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
