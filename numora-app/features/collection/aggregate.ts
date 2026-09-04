/**
 * features/collection/aggregate.ts
 * Funções puras de agregação financeira por exemplar (Etapa 15.4) — única
 * fonte de verdade para "quanto foi investido nesta moeda", usada por
 * Coleção (card grid, lista, ordenação "Maior valor de aquisição",
 * ConfirmDialog de "mover para a lixeira") e pela Lixeira. Nunca acessa o
 * banco — opera inteiramente sobre `item.units`, já carregado pela mesma
 * query (`ITEM_SELECT`) que traz o item (nenhuma query nova precisa
 * existir para nenhuma destas funções).
 *
 * "Exemplares do item" aqui inclui TODOS os `collection_units` do item,
 * nunca filtrado por `unit.status` (in_collection/for_trade/sold/...) —
 * vender/trocar um exemplar não o remove do item nem da coleção, e o
 * custo histórico não deixa de existir por isso. Soft-delete é só a nível
 * de ITEM (`collection_items.deleted_at`), nunca a nível de exemplar: um
 * item na Lixeira preserva exatamente os mesmos `collection_units` que
 * tinha quando ativo — por isso estas mesmas funções servem tanto a
 * Coleção quanto a Lixeira sem nenhuma distinção. Mesma convenção já
 * aprovada e em produção no Dashboard (Etapa 15.2 —
 * `lib/stats/collection-stats.ts`): `unit.unitCost ?? 0` somado, `null`
 * nunca interpretado como custo real zero.
 */
import type { CollectionItem, CollectionItemUnit } from './types'
import type { CollectionUnit } from '@/features/collection-units/types'
import type { PassportCollectionVisibility } from '@/features/profile/types'

/**
 * Nome próprio (em vez de acessar `item.units` direto em cada call site)
 * para deixar explícito que toda agregação financeira desta etapa é sobre
 * EXEMPLARES, nunca sobre a compra legada única do item
 * (`item.purchase`/`item.purchaseId`).
 */
export function getActiveUnits(item: CollectionItem): CollectionUnit[] {
  return item.units
}

/**
 * Soma de `unitCost` dos exemplares do item. `unitCost = null` (custo
 * desconhecido/cortesia/troca) conta como 0 na soma — nunca deixar de
 * contar os demais exemplares por causa de um exemplar sem custo
 * conhecido. Ver `getItemAcquisitionSummary` para a regra de quando isso
 * deve aparecer como "—" em vez de "R$ 0,00" na UI.
 */
export function getItemAcquisitionTotal(item: CollectionItem): number {
  return getActiveUnits(item).reduce((sum, unit) => sum + (unit.unitCost ?? 0), 0)
}

/** `null` quando o item não tem nenhum exemplar (nunca divide por zero — não deveria acontecer na prática, mas é um retorno seguro). */
export function getItemAverageAcquisitionCost(item: CollectionItem): number | null {
  const units = getActiveUnits(item)
  if (units.length === 0) return null
  return getItemAcquisitionTotal(item) / units.length
}

export interface ItemAcquisitionSummary {
  activeUnitCount: number
  totalInvested: number
  averageCost: number | null
  /**
   * `true` quando TODO exemplar do item compartilha o mesmo `unitCost` —
   * inclusive quando esse valor comum é `null` (nenhum exemplar tem custo
   * conhecido). Um item de 1 exemplar sempre cai aqui.
   */
  isUniform: boolean
  /** Só tem sentido quando `isUniform` é `true`. `null` = nenhum custo conhecido (não é o mesmo que R$0). */
  uniformCost: number | null
}

/**
 * Decide entre os 2 casos aprovados na Etapa 15.4 para "Preço de
 * aquisição": exemplares com custo uniforme mostram um único valor;
 * custos diferentes mostram contagem + total investido + custo médio.
 */
export function getItemAcquisitionSummary(item: CollectionItem): ItemAcquisitionSummary {
  const units = getActiveUnits(item)
  const distinctCosts = new Set(units.map((unit) => unit.unitCost))
  const isUniform = distinctCosts.size <= 1

  return {
    activeUnitCount: units.length,
    totalInvested: getItemAcquisitionTotal(item),
    averageCost: getItemAverageAcquisitionCost(item),
    isUniform,
    uniformCost: isUniform ? (units[0]?.unitCost ?? null) : null,
  }
}

/**
 * `purchaseId`s distintos e não-nulos dos exemplares do item — fonte real
 * de "esta moeda está vinculada a quais compras" (Etapa 15.4 §3/§6).
 * Nunca usar `item.purchaseId` (legado, só enxerga a 1ª compra do item)
 * para essa pergunta.
 */
export function getItemPurchaseIds(item: CollectionItem): string[] {
  return Array.from(
    new Set(getActiveUnits(item).map((unit) => unit.purchaseId).filter((id): id is string => id !== null)),
  )
}

/**
 * Exemplar principal do item (Etapa 10) — fonte de verdade é
 * `unit.isPrimary`, nunca mais a antiga convenção "mais antigo = principal".
 * O fallback para `units[0]` (que `CollectionRepository` sempre ordena por
 * `createdAt` ascendente) só existe para o caso defensivo de um item chegar
 * sem nenhum principal marcado — não deveria acontecer dado o backfill +
 * o índice único parcial no banco, mas a UI nunca fica sem exemplar
 * nenhum para representar a moeda.
 *
 * Extraída de `app/dashboard/collection/page.tsx` (Etapa "F2 — Closed
 * Beta Test Suite") para ser testável sem montar a página inteira —
 * mesmo padrão das demais funções deste arquivo. Nenhuma mudança de
 * comportamento, só de localização.
 */
export function getPrimaryUnit(item: CollectionItem): CollectionItemUnit | null {
  return item.units.find((u) => u.isPrimary) ?? item.units[0] ?? null
}

/**
 * Fundação de imagens — só oferece o botão de publicar foto quando a moeda
 * já apareceria no Passport (senão a foto nunca teria onde ser vista) e
 * existe de fato uma foto de frente no exemplar principal. Independente da
 * publicação de TEXTO (`isPublicInPassport`) já ter sido decidida antes —
 * publicar a foto continua exigindo o clique próprio, nunca decorre daqui.
 */
export function canPublishPhoto(item: CollectionItem, visibilityMode: PassportCollectionVisibility | null): boolean {
  const isVisibleOnPassport = visibilityMode === 'all' || (visibilityMode === 'selected' && item.isPublicInPassport)
  if (!isVisibleOnPassport) return false

  const primaryUnit = getPrimaryUnit(item)
  return primaryUnit?.images.some((image) => image.kind === 'front') ?? false
}
