/**
 * features/collection/repositories/collection.repository.ts
 * Infrastructure layer da feature de coleção (PROJECT_RULES.md §4.2) —
 * única camada que sabe o nome da tabela `collection_items` e de suas
 * colunas. Associa toda escrita ao usuário logado obtido da sessão,
 * nunca recebendo `user_id` de fora.
 *
 * Orquestra `PurchasesRepository` quando o item tem uma aquisição
 * vinculada (cria a compra antes do item, ou atualiza a compra existente
 * ao editar) — mas nunca conhece detalhes de UI de compras, só delega.
 * `collection_items.purchase_id` (Etapa 4) é quem representa essa
 * relação; não existe conceito de "lote" separado — vários itens podem
 * apontar para a mesma compra, isso não é modelado aqui.
 *
 * Também orquestra `CollectionUnitsRepository` (Etapa collection_units):
 * cada `collection_item` precisa de ao menos 1 `collection_unit` (o
 * exemplar físico). `quantity` não é mais escrito aqui — é um espelho de
 * `COUNT(collection_units)` mantido por trigger no banco; após
 * criar/inserir exemplares, o item é buscado de novo para refletir o
 * valor sincronizado. Reduzir a quantidade nunca é feito por aqui —
 * exige excluir exemplares individualmente (`CollectionUnitsRepository.remove`).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createSupabasePurchasesRepository } from '@/features/purchases/repositories/purchases.repository'
import {
  createSupabaseCollectionUnitsRepository,
  toCollectionUnit,
  type CollectionUnitRow,
} from '@/features/collection-units/repositories/collection-units.repository'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import type { CoinImageKind } from '@/features/coin-images/types'
import type {
  CatalogReference,
  CollectionItem,
  CollectionItemEnrichmentInput,
  CollectionItemInput,
  CollectionItemUnit,
} from '@/features/collection/types'

export interface CollectionRepository {
  list(): Promise<CollectionItem[]>
  get(id: string): Promise<CollectionItem | null>
  create(input: CollectionItemInput): Promise<CollectionItem>
  update(id: string, input: CollectionItemInput): Promise<CollectionItem>
  /**
   * Salva SOMENTE os campos do modal "Informações da moeda" (Etapa 11) —
   * `mint`, `mintage`, `history`, `trivia`, `catalogReferences`. Nunca
   * toca em `quantity`, `purchase`, país/ano/metal/peso/pureza/valor de
   * face nem em `collection_units` — deliberadamente um método separado
   * de `update()` para que este modal nunca possa sobrescrever por
   * acidente um campo que pertence ao formulário "Editar moeda".
   */
  updateEnrichment(id: string, input: CollectionItemEnrichmentInput): Promise<CollectionItem>
  remove(id: string): Promise<void>
}

/**
 * `metals` precisa de desambiguação (`!metal_code`/`!secondary_metal_code`)
 * porque collection_items tem duas FKs para metals — sem isso o
 * PostgREST não sabe qual relação usar. O alias `secondary_metals:`
 * renomeia o segundo embed para não colidir com `metals` no JSON de
 * resposta. As demais tabelas embutidas têm só uma FK cada, sem
 * ambiguidade.
 *
 * `collection_units` (com `grades` e `coin_images` aninhados) foi
 * incorporado nesta mesma query na Etapa 10 — a experiência de coleção
 * (busca/filtro/agrupamento por conservação e status, miniatura do
 * exemplar preferido) precisa desses dados por item, e embuti-los aqui
 * evita N+1 (uma query por item) que existiria se cada card chamasse
 * `CollectionUnitsRepository.listByItem` individualmente. Só os campos
 * leves de `coin_images` (kind + storage_path) são trazidos — nenhum
 * byte de imagem, nenhuma signed URL é gerada aqui.
 *
 * Lista de colunas EXPLÍCITA (não `*`) desde a Etapa 11: `mintage` é
 * `bigint` e precisa ser lido como `mintage::text` — comprovado em teste
 * real que sem esse cast o PostgREST devolve um número JSON puro que o
 * `JSON.parse` do JavaScript corrompe silenciosamente acima de
 * `Number.MAX_SAFE_INTEGER` (9007199254740993 virava 9007199254740992).
 * Combinar `*` com um cast explícito da mesma coluna geraria uma coluna
 * `mintage` duplicada e ambígua na resposta — por isso a lista completa.
 */
const ITEM_SELECT = `
  id, user_id, purchase_id, country_code, country_name, year, denomination, mint,
  metal_code, secondary_metal_code, gross_weight_g, purity, face_value, quantity,
  unit_cost_override, description, location, tags,
  mintage::text, history, trivia, catalog_references,
  created_at, updated_at,
  countries ( name, flag_emoji ),
  metals!metal_code ( name ),
  secondary_metals:metals!secondary_metal_code ( name ),
  purchases ( total_price, purchase_date, seller_name, notes ),
  collection_units ( *, grades ( label, scale ), coin_images ( kind, storage_path ) )
`

interface CollectionItemRow {
  id: string
  user_id: string
  purchase_id: string | null
  country_code: string | null
  country_name: string | null
  year: number | null
  denomination: string | null
  mint: string | null
  metal_code: string | null
  secondary_metal_code: string | null
  gross_weight_g: number | null
  purity: number | null
  face_value: number | null
  quantity: number
  unit_cost_override: number | null
  description: string | null
  location: string | null
  tags: string[] | null
  /** Vem como string — selecionado via `mintage::text` (ver comentário de `ITEM_SELECT`). */
  mintage: string | null
  history: string | null
  trivia: string | null
  /** `jsonb` já vem como array/objeto nativo do PostgREST — nunca uma string a re-parsear. */
  catalog_references: CatalogReference[] | null
  created_at: string
  updated_at: string
  countries: { name: string; flag_emoji: string | null } | null
  metals: { name: string } | null
  secondary_metals: { name: string } | null
  purchases: {
    total_price: number
    purchase_date: string | null
    seller_name: string | null
    notes: string | null
  } | null
  collection_units: (CollectionUnitRow & { coin_images: { kind: CoinImageKind; storage_path: string }[] })[]
}

function toCollectionItemUnit(
  row: CollectionUnitRow & { coin_images: { kind: CoinImageKind; storage_path: string }[] },
): CollectionItemUnit {
  return {
    ...toCollectionUnit(row),
    images: row.coin_images.map((image) => ({ kind: image.kind, storagePath: image.storage_path })),
  }
}

function toCollectionItem(row: CollectionItemRow): CollectionItem {
  return {
    id: row.id,
    userId: row.user_id,
    purchaseId: row.purchase_id,
    countryCode: row.country_code,
    countryName: row.country_name,
    year: row.year,
    denomination: row.denomination,
    mint: row.mint,
    metalCode: row.metal_code,
    secondaryMetalCode: row.secondary_metal_code,
    grossWeightG: row.gross_weight_g,
    purity: row.purity,
    faceValue: row.face_value,
    quantity: row.quantity,
    unitCostOverride: row.unit_cost_override,
    description: row.description,
    location: row.location,
    tags: row.tags,
    mintage: row.mintage,
    history: row.history,
    trivia: row.trivia,
    catalogReferences: row.catalog_references,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    countryDisplayName: row.countries?.name ?? null,
    countryFlagEmoji: row.countries?.flag_emoji ?? null,
    metalName: row.metals?.name ?? null,
    secondaryMetalName: row.secondary_metals?.name ?? null,
    purchase: row.purchases
      ? {
          totalPrice: row.purchases.total_price,
          purchaseDate: row.purchases.purchase_date,
          sellerName: row.purchases.seller_name,
          notes: row.purchases.notes,
        }
      : null,
    // Ordenado aqui (não confiando na ordem de retorno do embed). `id` como
    // desempate: exemplares criados em lote (createMany) têm createdAt
    // IDÊNTICO (mesma transação) — sem isso, a numeração "#1/#2/#3" na UI
    // poderia mudar entre requisições para os mesmos dados.
    units: row.collection_units
      .map(toCollectionItemUnit)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
  }
}

export function createSupabaseCollectionRepository(): CollectionRepository {
  const supabase = getSupabaseBrowserClient()
  const purchasesRepository = createSupabasePurchasesRepository()
  const collectionUnitsRepository = createSupabaseCollectionUnitsRepository()
  const coinImagesRepository = createSupabaseCoinImagesRepository()

  async function get(id: string): Promise<CollectionItem | null> {
    const { data, error } = await supabase.from('collection_items').select(ITEM_SELECT).eq('id', id).maybeSingle()

    if (error) {
      throw new Error(`[CollectionRepository] Falha ao buscar item: ${error.message}`)
    }

    return data ? toCollectionItem(data as unknown as CollectionItemRow) : null
  }

  return {
    async list() {
      const { data, error } = await supabase
        .from('collection_items')
        .select(ITEM_SELECT)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao listar itens: ${error.message}`)
      }

      return (data as unknown as CollectionItemRow[]).map(toCollectionItem)
    },

    get,

    async create(input) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[CollectionRepository] Nenhum usuário logado para associar o item.')
      }

      let purchaseId: string | null = null
      if (input.purchase) {
        const purchase = await purchasesRepository.create(input.purchase)
        purchaseId = purchase.id
      }

      const { data, error } = await supabase
        .from('collection_items')
        .insert({
          user_id: user.id,
          purchase_id: purchaseId,
          country_code: input.countryCode,
          year: input.year,
          denomination: input.denomination,
          metal_code: input.metalCode,
          secondary_metal_code: input.secondaryMetalCode,
          gross_weight_g: input.grossWeightG,
          purity: input.purity,
          face_value: input.faceValue,
        })
        .select(ITEM_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao adicionar item: ${error.message}`)
      }

      const created = toCollectionItem(data as unknown as CollectionItemRow)

      // Todo item precisa de ao menos 1 exemplar físico — quantity (ainda no
      // valor padrão da coluna) só reflete a realidade depois que o trigger
      // de sincronização roda em resposta a este insert em collection_units.
      await collectionUnitsRepository.createMany(created.id, Math.max(1, input.quantity), input.initialGradeId)

      const withUnits = await get(created.id)
      if (!withUnits) {
        throw new Error('[CollectionRepository] Item criado, mas não foi possível recarregá-lo.')
      }

      return withUnits
    },

    async update(id, input) {
      const current = await get(id)
      if (!current) {
        throw new Error('[CollectionRepository] Item não encontrado.')
      }

      if (input.quantity < current.quantity) {
        // A UI já bloqueia isso — esta checagem é só uma segunda camada de
        // defesa. Reduzir quantidade exige excluir exemplares individuais
        // (CollectionUnitsRepository.remove), nunca um número solto aqui:
        // não há como saber qual exemplar o usuário quer remover.
        throw new Error(
          '[CollectionRepository] Não é possível reduzir a quantidade por aqui. Exclua exemplares individualmente.',
        )
      }

      let purchaseId = current.purchaseId
      if (input.purchase) {
        if (purchaseId) {
          await purchasesRepository.update(purchaseId, input.purchase)
        } else {
          const purchase = await purchasesRepository.create(input.purchase)
          purchaseId = purchase.id
        }
      }

      const { data, error } = await supabase
        .from('collection_items')
        .update({
          purchase_id: purchaseId,
          country_code: input.countryCode,
          year: input.year,
          denomination: input.denomination,
          metal_code: input.metalCode,
          secondary_metal_code: input.secondaryMetalCode,
          gross_weight_g: input.grossWeightG,
          purity: input.purity,
          face_value: input.faceValue,
        })
        .eq('id', id)
        .select(ITEM_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao atualizar item: ${error.message}`)
      }

      const updated = toCollectionItem(data as unknown as CollectionItemRow)

      const missingUnits = input.quantity - current.quantity
      if (missingUnits > 0) {
        // Exemplares novos nascem sem conservação própria (decisão aprovada
        // — não herdar automaticamente de exemplares já existentes).
        await collectionUnitsRepository.createMany(id, missingUnits, null)
        const withUnits = await get(id)
        if (!withUnits) {
          throw new Error('[CollectionRepository] Item atualizado, mas não foi possível recarregá-lo.')
        }
        return withUnits
      }

      return updated
    },

    async updateEnrichment(id, input) {
      // `mintage` vai como STRING no payload — o PostgREST passa o valor
      // ao Postgres como parâmetro de texto e é o próprio `bigint` do
      // Postgres que faz o parse, nunca um `number` do JavaScript no
      // caminho: a precisão do valor original nunca é arriscada aqui,
      // simetricamente à leitura via `mintage::text` em `ITEM_SELECT`.
      const { data, error } = await supabase
        .from('collection_items')
        .update({
          mint: input.mint,
          mintage: input.mintage,
          history: input.history,
          trivia: input.trivia,
          catalog_references: input.catalogReferences,
        })
        .eq('id', id)
        .select(ITEM_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao salvar informações da moeda: ${error.message}`)
      }

      return toCollectionItem(data as unknown as CollectionItemRow)
    },

    async remove(id) {
      // Excluir a moeda cascateia todos os collection_units (banco), e cada
      // unit cascateia suas linhas de coin_images — mas não os arquivos
      // físicos no Storage. Por isso limpamos o Storage de todas as units
      // do item ANTES de excluir o item; se alguma remoção falhar, a
      // exclusão da moeda inteira é abortada.
      const units = await collectionUnitsRepository.listByItem(id)
      for (const unit of units) {
        const images = await coinImagesRepository.listByUnit(unit.id)
        for (const image of images) {
          await coinImagesRepository.remove(image)
        }
      }

      const { error } = await supabase.from('collection_items').delete().eq('id', id)

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao excluir item: ${error.message}`)
      }
    },
  }
}
