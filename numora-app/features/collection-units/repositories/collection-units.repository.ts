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
import type {
  CollectionUnit,
  CollectionUnitInput,
  CollectionUnitStatus,
  CostOrigin,
  CostType,
} from '@/features/collection-units/types'

/** Código Postgres da exceção customizada em `check_collection_unit_not_last()`. */
const LAST_UNIT_ERROR_CODE = 'P0001'
/** Mesma mensagem do trigger — usada na checagem prévia feita aqui antes do Storage. */
const LAST_UNIT_MESSAGE = 'Esta moeda possui apenas um exemplar. Para removê-la da coleção, use a opção Excluir moeda.'

/**
 * Etapa 14.3 — quando exemplares novos nascem de uma compra real (`create()`
 * de uma moeda nova, ou aumento de `quantity` com uma nova aquisição
 * vinculada), o repositório de `collection_items` passa o `purchaseId` e o
 * `totalAmount` a ratear entre os `count` exemplares sendo criados AGORA
 * (nunca o total da purchase inteira, se ela também cobrir exemplares já
 * existentes — quem decide esse valor é o chamador). `null`/omitido = sem
 * informação de custo (exemplares nascem com `costType: 'unknown'`).
 */
export interface UnitPurchaseAllocation {
  purchaseId: string
  totalAmount: number
}

export interface CollectionUnitsRepository {
  listByItem(collectionItemId: string): Promise<CollectionUnit[]>
  createMany(
    collectionItemId: string,
    count: number,
    gradeId: string | null,
    purchaseAllocation?: UnitPurchaseAllocation | null,
  ): Promise<CollectionUnit[]>
  update(id: string, input: CollectionUnitInput): Promise<CollectionUnit>
  remove(id: string): Promise<void>
  /**
   * Define `unitId` como o exemplar principal do item, desmarcando
   * atomicamente o principal anterior (Etapa 10) — via RPC
   * `set_primary_collection_unit` no banco, nunca por dois `update()`
   * separados daqui (evitaria a garantia de nunca existir 0 ou 2
   * principais simultâneos). RLS/ownership são verificados dentro da RPC.
   */
  setPrimary(unitId: string): Promise<void>
}

const UNIT_SELECT = `*, grades ( label, scale )`

/** Exportado para reuso por `CollectionRepository`, que embute exemplares na mesma query de `collection_items` (Etapa 10). */
export interface CollectionUnitRow {
  id: string
  collection_item_id: string
  grade_id: string | null
  status: CollectionUnitStatus
  rating: number | null
  is_primary: boolean
  created_at: string
  updated_at: string
  grades: { label: string; scale: string } | null
  purchase_id: string | null
  unit_cost: number | null
  cost_origin: CostOrigin
  cost_type: CostType
}

export function toCollectionUnit(row: CollectionUnitRow): CollectionUnit {
  return {
    id: row.id,
    collectionItemId: row.collection_item_id,
    gradeId: row.grade_id,
    gradeLabel: row.grades?.label ?? null,
    gradeScale: row.grades?.scale ?? null,
    status: row.status,
    rating: row.rating,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    purchaseId: row.purchase_id,
    unitCost: row.unit_cost,
    costOrigin: row.cost_origin,
    costType: row.cost_type,
  }
}

/**
 * Rateio determinístico (Etapa 14.1-R2 §9): todo exemplar exceto o último
 * (na ordem recebida) leva `TRUNC(total / N, 2)`; o último absorve o resto
 * exato, garantindo `SUM(resultado) === totalAmount` sempre. Arredondamento
 * feito em CENTAVOS INTEIROS (nunca em ponto flutuante decimal) para não
 * arriscar divergência de 1 centavo por erro de precisão de `number`.
 *
 * Ex.: R$100,00 ÷ 3 → [33.33, 33.33, 33.34].
 */
function allocateAmountEqually(totalAmount: number, count: number): number[] {
  const totalCents = Math.round(totalAmount * 100)
  const baseCents = Math.trunc(totalCents / count)
  const amounts = new Array<number>(count).fill(baseCents)
  amounts[count - 1] = totalCents - baseCents * (count - 1)
  return amounts.map((cents) => cents / 100)
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
        // `id` como desempate: exemplares criados em lote (createMany) têm
        // created_at IDÊNTICO (mesma transação) — sem um segundo critério,
        // a ordem "#1/#2/#3" poderia mudar entre requisições.
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

      if (error) {
        throw new Error(`[CollectionUnitsRepository] Falha ao listar exemplares: ${error.message}`)
      }

      return (data as unknown as CollectionUnitRow[]).map(toCollectionUnit)
    },

    async createMany(collectionItemId, count, gradeId, purchaseAllocation) {
      // Etapa 14.3: os `id`s são gerados aqui (não pelo default do banco) e
      // ORDENADOS antes do insert — é o que garante que o exemplar que recebe
      // o resto do rateio (`allocateAmountEqually`, último da lista) seja
      // exatamente o mesmo que a UI vai exibir por último (`created_at ASC,
      // id ASC`, mesmo critério de desempate usado em toda a feature — como
      // todo o lote nasce na mesma transação, `created_at` é idêntico entre
      // eles, então só a ordenação prévia dos ids garante esse alinhamento;
      // esperar o retorno do insert para descobrir os ids só depois seria
      // tarde demais para decidir quem leva o resto).
      const ids = Array.from({ length: count }, () => crypto.randomUUID()).sort((a, b) => a.localeCompare(b))

      const costs = purchaseAllocation ? allocateAmountEqually(purchaseAllocation.totalAmount, count) : null

      const rows = ids.map((id, index) => ({
        id,
        collection_item_id: collectionItemId,
        grade_id: gradeId,
        status: 'in_collection' as const,
        rating: null,
        purchase_id: purchaseAllocation?.purchaseId ?? null,
        unit_cost: costs ? costs[index] : null,
        cost_origin: 'auto' as const,
        cost_type: purchaseAllocation ? ('purchase' as const) : ('unknown' as const),
      }))

      const { data, error } = await supabase.from('collection_units').insert(rows).select(UNIT_SELECT)

      if (error) {
        throw new Error(`[CollectionUnitsRepository] Falha ao criar exemplares: ${error.message}`)
      }

      let inserted = data as unknown as CollectionUnitRow[]

      // Um item nunca deve ficar com exemplares e sem principal (Etapa 10).
      // Isto só promove algo quando o item ainda não tem NENHUM principal —
      // o caso comum é a criação da própria moeda agora; ao só aumentar a
      // quantidade de um item já existente, ele sempre já tem um principal
      // e este bloco não faz nada. Duas chamadas HTTP (insert + esta
      // checagem/promoção), não uma transação só — ver nota de
      // transparência no relatório da Etapa 10 sobre por que isso é
      // aceitável aqui (o fallback defensivo "mais antigo" na UI cobre a
      // rara janela de falha entre as duas).
      const { data: existingPrimary, error: primaryCheckError } = await supabase
        .from('collection_units')
        .select('id')
        .eq('collection_item_id', collectionItemId)
        .eq('is_primary', true)
        .maybeSingle()

      if (primaryCheckError) {
        throw new Error(`[CollectionUnitsRepository] Falha ao verificar exemplar principal: ${primaryCheckError.message}`)
      }

      if (!existingPrimary) {
        // `id` como desempate: todo o lote foi inserido na MESMA transação,
        // então `created_at` é idêntico entre eles — comparar só por
        // created_at tornaria a escolha do principal não-determinística.
        const oldest = [...inserted].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        )[0]
        const { data: promoted, error: promoteError } = await supabase
          .from('collection_units')
          .update({ is_primary: true })
          .eq('id', oldest.id)
          .select(UNIT_SELECT)
          .single()

        if (promoteError) {
          throw new Error(`[CollectionUnitsRepository] Falha ao definir exemplar principal: ${promoteError.message}`)
        }

        inserted = inserted.map((row) => (row.id === promoted.id ? (promoted as unknown as CollectionUnitRow) : row))
      }

      return inserted.map(toCollectionUnit)
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

    async setPrimary(unitId) {
      const { error } = await supabase.rpc('set_primary_collection_unit', { p_unit_id: unitId })

      if (error) {
        throw new Error(`[CollectionUnitsRepository] Falha ao definir exemplar principal: ${error.message}`)
      }
    },
  }
}
