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
import * as Sentry from '@sentry/nextjs'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createSupabasePurchasesRepository } from '@/features/purchases/repositories/purchases.repository'
import {
  createSupabaseCollectionUnitsRepository,
  toCollectionUnit,
  type CollectionUnitRow,
} from '@/features/collection-units/repositories/collection-units.repository'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import type { CoinImageKind } from '@/features/coin-images/types'
import { trackItemAdded, trackFirstItemAdded } from '@/lib/analytics/events/product-events'
import type {
  CatalogReference,
  CollectionItem,
  CollectionItemEnrichmentInput,
  CollectionItemInput,
  CollectionItemUnit,
} from '@/features/collection/types'

export interface CollectionRepository {
  /** Só itens ATIVOS (`deleted_at is null`) — a coleção que o usuário vê hoje. */
  list(): Promise<CollectionItem[]>
  /** Só itens ATIVOS — usado internamente após create/update, que só operam sobre itens ativos. */
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
  /**
   * Passport V1 (Fase 3) — só liga/desliga `is_public`. Método dedicado
   * (não parte de `update()`/`updateEnrichment()`) pela mesma razão de
   * `ProfileRepository.setPassportPublic`: uma ação de visibilidade
   * pública merece ficar isolada e auditável, nunca escondida dentro de um
   * payload de edição maior. Só tem efeito real quando o perfil do dono
   * está com `passportCollectionVisibility = 'selected'` — a RPC pública
   * decide isso, não este método.
   */
  setPublicInPassport(id: string, value: boolean): Promise<CollectionItem>
  /**
   * Etapa Lixeira — move para a lixeira (`deleted_at = now()`). Só essa
   * coluna muda: nenhum `collection_unit`, `coin_image`, arquivo do
   * Storage ou `purchase` é tocado. Update mínimo (sem `.select()`), não
   * reconstrói o item inteiro — só o que precisa mudar muda.
   */
  softDelete(id: string): Promise<void>
  /** Etapa Lixeira — reverte (`deleted_at = null`). Mesma granularidade mínima de `softDelete`. */
  restore(id: string): Promise<void>
  /** Etapa Lixeira — só itens NA lixeira (`deleted_at is not null`), mais recentemente excluídos primeiro. */
  listTrashed(): Promise<CollectionItem[]>
  /**
   * Exclusão PERMANENTE e destrutiva — cascata real de `collection_units`/
   * `coin_images` no banco + limpeza de Storage. Etapa Lixeira: só deve
   * ser chamado a partir da Lixeira (sobre um item que já tem `deleted_at`
   * preenchido), nunca a partir da coleção ativa.
   */
  remove(id: string): Promise<void>
  /**
   * Etapa 15.4 — substitui `countOtherItemsForPurchase` (removido: contava
   * `collection_items.purchase_id`, cego a qualquer compra além da 1ª do
   * item). Recebe TODOS os `purchaseId`s distintos presentes em
   * `item.units` (ver `getItemPurchaseIds`) e responde: quantos OUTROS
   * `collection_items` (com pelo menos 1 exemplar ATIVO, ou seja,
   * pertencente a um item não excluído) têm algum exemplar apontando para
   * qualquer uma dessas compras. Uma única query (nunca 1 por
   * `purchaseId`); a deduplicação por `collection_item_id` acontece aqui
   * mesmo, em memória, então um item com exemplares de 2 compras do
   * conjunto nunca é contado 2 vezes. Usada só ao abrir o ConfirmDialog de
   * "mover para a lixeira", para avisar quando a compra é compartilhada.
   */
  countOtherItemsForPurchases(purchaseIds: string[], excludeItemId: string): Promise<number>
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
  created_at, updated_at, deleted_at, is_public,
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
  /** Etapa Lixeira — `null` = ativo, preenchido = na lixeira. Única fonte de verdade (ver types.ts). */
  deleted_at: string | null
  /** Passport V1 (Fase 3) — ver comentário em `CollectionItem.isPublicInPassport` (types.ts). */
  is_public: boolean
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
    deletedAt: row.deleted_at,
    isPublicInPassport: row.is_public,
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
    const { data, error } = await supabase
      .from('collection_items')
      .select(ITEM_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

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
        .is('deleted_at', null)
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
      let purchaseTotal: number | null = null
      if (input.purchase) {
        const purchase = await purchasesRepository.create(input.purchase)
        purchaseId = purchase.id
        purchaseTotal = purchase.totalPrice
      }

      const { data, error } = await supabase
        .from('collection_items')
        .insert({
          user_id: user.id,
          // Etapa 14.3: continua escrito para dado novo (dual-write) — o
          // Dashboard/Histórico de aquisições (Etapa 13.2/13.3) ainda lê
          // exclusivamente daqui; a migração dessas leituras para
          // collection_units fica para uma etapa futura (ver relatório).
          // A fonte de verdade do custo por exemplar, a partir de agora, é
          // sempre collection_units — este campo é só compatibilidade.
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
      // Etapa 14.3: cada exemplar nasce já com purchase_id/unit_cost/
      // cost_type próprios (rateio determinístico do total da purchase
      // entre os `quantity` exemplares desta mesma criação).
      await collectionUnitsRepository.createMany(
        created.id,
        Math.max(1, input.quantity),
        input.initialGradeId,
        purchaseId && purchaseTotal !== null ? { purchaseId, totalAmount: purchaseTotal } : null,
      )

      const withUnits = await get(created.id)
      if (!withUnits) {
        throw new Error('[CollectionRepository] Item criado, mas não foi possível recarregá-lo.')
      }

      // Etapa 15.10.4 — analytics é best-effort e roda só DEPOIS que o item
      // já está criado com sucesso (nunca antes, nunca bloqueia a operação
      // de negócio). "Primeiro item" = verdade do banco, não contador
      // client-side: uma única query COUNT (head:true, sem trazer linhas)
      // depois do insert — se o total de collection_items deste usuário é
      // exatamente 1, este é o primeiro item que ele já criou (mesmo padrão
      // de `collection-units.repository.ts` para "último exemplar"). Conta
      // TODOS os itens do usuário, sem filtro de `deleted_at` — um item
      // criado e depois excluído/restaurado não faz o usuário "ativar" de
      // novo. Falha aqui (rede, etc.) nunca deve impedir a criação do item
      // já concluída — por isso todo este bloco está isolado em try/catch,
      // mesmo padrão de `features/auth/repositories/auth.repository.ts`.
      //
      // Race condition conhecida e aceita (não mitigada nesta etapa): duas
      // criações concorrentes do PRIMEIRO item do mesmo usuário (ex.: duas
      // abas) podem ambas ler count=2 e nenhuma disparar `first_item_added`,
      // ou em casos raríssimos de timing ambas lerem count=1. Como é só
      // analytics (nunca fonte de verdade de negócio), esse desvio é
      // aceitável — a ativação REAL do usuário já aconteceu no banco de
      // qualquer forma, independente deste evento.
      try {
        const { count } = await supabase
          .from('collection_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)

        trackItemAdded()
        if (count === 1) {
          trackFirstItemAdded()
        }
      } catch (err) {
        // Nunca bloqueia a criação do item — analytics é best-effort.
        Sentry.captureException(err)
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

      const missingUnits = input.quantity - current.quantity

      // Etapa 14.3 — corrige o achado da auditoria 14.1 (achado novo #4):
      // aumentar `quantity` NUNCA MAIS reescreve uma purchase já existente.
      // Exemplares novos + uma compra informada = uma NOVA aquisição, então
      // sempre cria uma purchase nova só para eles. A purchase já vinculada
      // ao item (se houver) fica intocada — só é atualizada no lugar quando
      // NÃO há exemplares novos (edição pura de metadados da mesma compra).
      let purchaseId = current.purchaseId
      let newPurchaseForNewUnits: { purchaseId: string; totalAmount: number } | null = null

      if (missingUnits > 0 && input.purchase) {
        const newPurchase = await purchasesRepository.create(input.purchase)
        newPurchaseForNewUnits = { purchaseId: newPurchase.id, totalAmount: newPurchase.totalPrice }
        if (purchaseId === null) {
          // Item nunca teve nenhuma purchase vinculada — não há nada a
          // preservar, então linkar a nova aqui é seguro e mantém o
          // Dashboard legado (que hoje só enxerga collection_items.
          // purchase_id) mostrando ao menos esta aquisição.
          purchaseId = newPurchase.id
        }
        // Se já havia uma purchase vinculada, ela permanece EXATAMENTE como
        // estava — não é sobrescrita nem apagada. O Dashboard legado não vai
        // exibir esta segunda aquisição até as queries de Histórico
        // migrarem de collection_items para collection_units (fora do
        // escopo desta etapa, ver relatório) — o que importa aqui é que a
        // purchase original nunca mais é corrompida, que era o bug real.
      } else if (input.purchase) {
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

      if (missingUnits > 0) {
        // Exemplares novos nascem sem conservação própria (decisão aprovada
        // — não herdar automaticamente de exemplares já existentes). Etapa
        // 14.3: recebem purchase_id/unit_cost da NOVA purchase (se houver) —
        // nunca da purchase antiga do item.
        await collectionUnitsRepository.createMany(id, missingUnits, null, newPurchaseForNewUnits)
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

    async setPublicInPassport(id, value) {
      const { data, error } = await supabase
        .from('collection_items')
        .update({ is_public: value })
        .eq('id', id)
        .select(ITEM_SELECT)
        .single()

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao atualizar visibilidade no Passport: ${error.message}`)
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

    async softDelete(id) {
      const { error } = await supabase
        .from('collection_items')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao mover item para a lixeira: ${error.message}`)
      }
    },

    async restore(id) {
      const { error } = await supabase.from('collection_items').update({ deleted_at: null }).eq('id', id)

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao restaurar item: ${error.message}`)
      }
    },

    async listTrashed() {
      const { data, error } = await supabase
        .from('collection_items')
        .select(ITEM_SELECT)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao listar itens da lixeira: ${error.message}`)
      }

      return (data as unknown as CollectionItemRow[]).map(toCollectionItem)
    },

    async countOtherItemsForPurchases(purchaseIds, excludeItemId) {
      if (purchaseIds.length === 0) return 0

      // `collection_units.purchase_id in (...)` + embed `collection_items`
      // filtrado a `deleted_at is null` (`!inner` obrigatório para poder
      // filtrar coluna do embed) — "exemplar ATIVO" = pertence a um item
      // não excluído. Uma única query; a contagem de collection_items
      // DISTINTOS (nunca de linhas de exemplar) é feita em memória via Set,
      // porque PostgREST não tem "count distinct" nativo — o volume aqui é
      // sempre pequeno (só exemplares das compras em questão), então isso
      // não é um risco de performance.
      const { data, error } = await supabase
        .from('collection_units')
        .select('collection_item_id, collection_items!inner ( deleted_at )')
        .in('purchase_id', purchaseIds)
        .is('collection_items.deleted_at', null)

      if (error) {
        throw new Error(`[CollectionRepository] Falha ao verificar compra compartilhada: ${error.message}`)
      }

      const rows = (data ?? []) as unknown as { collection_item_id: string }[]
      const distinctItemIds = new Set(rows.map((row) => row.collection_item_id))
      distinctItemIds.delete(excludeItemId)

      return distinctItemIds.size
    },
  }
}
