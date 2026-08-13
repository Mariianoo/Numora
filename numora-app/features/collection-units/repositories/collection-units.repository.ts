/**
 * features/collection-units/repositories/collection-units.repository.ts
 * Infrastructure layer dos exemplares físicos (PROJECT_RULES.md §4.2) —
 * única camada que sabe o nome da tabela `collection_units` e de suas
 * colunas. Ownership nunca é enviado pelo frontend: é resolvido pela RLS
 * via `collection_units.collection_item_id -> collection_items.user_id`,
 * então este repositório não precisa (nem deve) consultar o usuário
 * logado — o Postgres rejeita qualquer tentativa de ler/escrever um
 * exemplar que não pertença a `collection_items` do dono da sessão.
 *
 * `remove()` também limpa as fotos do exemplar (Etapa coin_images):
 * `ON DELETE CASCADE` de `coin_images.collection_unit_id` remove as
 * LINHAS do banco automaticamente quando o exemplar é excluído, mas não
 * remove os OBJETOS físicos no Storage — isso não existe como conceito
 * para o Postgres. Por isso o Storage é limpo aqui, ANTES do delete do
 * exemplar: se a limpeza falhar, a exclusão é abortada (nada é
 * excluído), em vez de arriscar objetos órfãos no bucket.
 *
 * Antes de tocar no Storage, verificamos se o exemplar é o último do
 * item — a mesma regra que o trigger `prevent_last_unit_delete` aplica
 * no banco. Sem essa checagem prévia, poderíamos apagar as fotos e só
 * depois descobrir (pelo erro do trigger) que a exclusão nunca seria
 * permitida, perdendo as fotos de um exemplar que continua existindo.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import type { CollectionUnit, CollectionUnitInput, CollectionUnitStatus } from '@/features/collection-units/types'

/** Código Postgres da exceção customizada em `check_collection_unit_not_last()`. */
const LAST_UNIT_ERROR_CODE = 'P0001'
/** Mesma mensagem do trigger — usada na checagem prévia feita aqui antes do Storage. */
const LAST_UNIT_MESSAGE = 'Esta moeda possui apenas um exemplar. Para removê-la da coleção, use a opção Excluir moeda.'

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
  const coinImagesRepository = createSupabaseCoinImagesRepository()

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
      const { data: unitRow, error: unitError } = await supabase
        .from('collection_units')
        .select('collection_item_id')
        .eq('id', id)
        .maybeSingle()

      if (unitError) {
        throw new Error(`[CollectionUnitsRepository] Falha ao localizar exemplar: ${unitError.message}`)
      }
      if (!unitRow) {
        throw new Error('[CollectionUnitsRepository] Exemplar não encontrado.')
      }

      const { count, error: countError } = await supabase
        .from('collection_units')
        .select('id', { count: 'exact', head: true })
        .eq('collection_item_id', unitRow.collection_item_id)

      if (countError) {
        throw new Error(`[CollectionUnitsRepository] Falha ao verificar exemplares: ${countError.message}`)
      }

      if ((count ?? 0) <= 1) {
        throw new Error(LAST_UNIT_MESSAGE)
      }

      // Storage antes do banco: se alguma remoção falhar, para aqui — o
      // exemplar (e as fotos que sobrarem) continuam intactos.
      const images = await coinImagesRepository.listByUnit(id)
      for (const image of images) {
        await coinImagesRepository.remove(image)
      }

      const { error } = await supabase.from('collection_units').delete().eq('id', id)

      if (error) {
        // P0001 vem de check_collection_unit_not_last() — mensagem já pronta para o usuário.
        // Só alcançável aqui numa corrida rara entre a checagem acima e este delete.
        if (error.code === LAST_UNIT_ERROR_CODE) {
          throw new Error(error.message)
        }
        throw new Error(`[CollectionUnitsRepository] Falha ao excluir exemplar: ${error.message}`)
      }
    },
  }
}
