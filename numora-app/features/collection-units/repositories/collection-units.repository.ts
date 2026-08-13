/**
 * features/collection-units/repositories/collection-units.repository.ts
 * Infrastructure layer dos exemplares físicos (PROJECT_RULES.md §4.2) —
 * única camada que sabe o nome da tabela `collection_units` e de suas
 * colunas. Ownership nunca é enviado pelo frontend: é resolvido pela RLS
 * via `collection_units.collection_item_id -> collection_items.user_id`,
 * então este repositório não precisa (nem deve) consultar o usuário
 * logado — o Postgres rejeita qualquer tentativa de ler/escrever um
 * exemplar que não pertença a `collection_items` do dono da sessão.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { CollectionUnit, CollectionUnitInput, CollectionUnitStatus } from '@/features/collection-units/types'

/** Código Postgres da exceção customizada em `check_collection_unit_not_last()`. */
const LAST_UNIT_ERROR_CODE = 'P0001'

export interface CollectionUnitsRepository {
  listByItem(collectionItemId: string): Promise<CollectionUnit[]>
  createMany(collectionItemId: string, count: number, gradeId: string | null): Promise<CollectionUnit[]>
  update(id: string, input: CollectionUnitInput): Promise<CollectionUnit>
  remove(id: string): Promise<void>
}

const UNIT_SELECT = `*, grades ( label, scale )`

interface CollectionUnitRow {
  id: string
  collection_item_id: string
  grade_id: string | null
  status: CollectionUnitStatus
  rating: number | null
  created_at: string
  updated_at: string
  grades: { label: string; scale: string } | null
}

function toCollectionUnit(row: CollectionUnitRow): CollectionUnit {
  return {
    id: row.id,
    collectionItemId: row.collection_item_id,
    gradeId: row.grade_id,
    gradeLabel: row.grades?.label ?? null,
    gradeScale: row.grades?.scale ?? null,
    status: row.status,
    rating: row.rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSupabaseCollectionUnitsRepository(): CollectionUnitsRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listByItem(collectionItemId) {
      const { data, error } = await supabase
        .from('collection_units')
        .select(UNIT_SELECT)
        .eq('collection_item_id', collectionItemId)
        .order('created_at', { ascending: true })

      if (error) {
        throw new Error(`[CollectionUnitsRepository] Falha ao listar exemplares: ${error.message}`)
      }

      return (data as unknown as CollectionUnitRow[]).map(toCollectionUnit)
    },

    async createMany(collectionItemId, count, gradeId) {
      const rows = Array.from({ length: count }, () => ({
        collection_item_id: collectionItemId,
        grade_id: gradeId,
        status: 'in_collection' as const,
        rating: null,
      }))

      const { data, error } = await supabase.from('collection_units').insert(rows).select(UNIT_SELECT)

      if (error) {
        throw new Error(`[CollectionUnitsRepository] Falha ao criar exemplares: ${error.message}`)
      }

      return (data as unknown as CollectionUnitRow[]).map(toCollectionUnit)
    },

    async update(id, input) {
      const { data, error } = await supabase
        .from('collection_units')
        .update({
          grade_id: input.gradeId,
          status: input.status,
          rating: input.rating,
        })
        .eq('id', id)
        .select(UNIT_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionUnitsRepository] Falha ao atualizar exemplar: ${error.message}`)
      }

      return toCollectionUnit(data as unknown as CollectionUnitRow)
    },

    async remove(id) {
      const { error } = await supabase.from('collection_units').delete().eq('id', id)

      if (error) {
        // P0001 vem de check_collection_unit_not_last() — mensagem já pronta para o usuário.
        if (error.code === LAST_UNIT_ERROR_CODE) {
          throw new Error(error.message)
        }
        throw new Error(`[CollectionUnitsRepository] Falha ao excluir exemplar: ${error.message}`)
      }
    },
  }
}
