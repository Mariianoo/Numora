/**
 * features/collection/types.ts
 * Tipagens de domínio da feature de coleção (collection_items) e das
 * tabelas de referência que a alimentam (countries, metals, grades).
 */
import type { PurchaseInput } from '@/features/purchases/types'
import type { CollectionUnit } from '@/features/collection-units/types'
import type { CoinImageKind } from '@/features/coin-images/types'

/** Só o necessário para saber "existe foto de frente?" sem baixar a imagem — a URL assinada é gerada à parte, sob demanda (Etapa 10). */
export interface CollectionItemUnitImage {
  kind: CoinImageKind
  storagePath: string
}

/**
 * Exemplar físico com suas fotos (metadados, não os bytes), embutido
 * dentro de `CollectionItem.units` pela mesma query de `list()`/`get()` —
 * evita N+1 ao exibir conservação/status/rating por exemplar na lista de
 * moedas (Etapa 10). Continua sendo a mesma entidade de
 * `features/collection-units`, só que carregada em lote.
 */
export interface CollectionItemUnit extends CollectionUnit {
  images: CollectionItemUnitImage[]
}

export interface CollectionItem {
  id: string
  userId: string
  purchaseId: string | null
  countryCode: string | null
  countryName: string | null
  year: number | null
  denomination: string | null
  mint: string | null
  metalCode: string | null
  secondaryMetalCode: string | null
  grossWeightG: number | null
  purity: number | null
  faceValue: number | null
  /**
   * Espelho de `COUNT(collection_units)`, mantido pelo banco (trigger) —
   * nunca escrito diretamente pela aplicação. Fonte de verdade real é a
   * tabela `collection_units` (ver features/collection-units).
   */
  quantity: number
  unitCostOverride: number | null
  description: string | null
  location: string | null
  tags: string[] | null
  createdAt: string
  updatedAt: string
  /** Resolvidos via join — nomes de exibição, não colunas próprias. */
  countryDisplayName: string | null
  countryFlagEmoji: string | null
  metalName: string | null
  /** Nome de exibição do segundo metal (moeda bimetálica), quando houver. */
  secondaryMetalName: string | null
  /** Dados da compra vinculada (purchases), quando existir. */
  purchase: {
    totalPrice: number
    purchaseDate: string | null
    sellerName: string | null
    notes: string | null
  } | null
  /** Ordenados por `createdAt` ascendente — `units[0]` é o exemplar mais antigo (convenção de "exemplar preferido" desta etapa, ver Etapa 10). */
  units: CollectionItemUnit[]
}

/**
 * Dados do formulário "Adicionar/Editar moeda" — país, ano, denominação,
 * metal (+ segundo metal opcional, para moedas bimetálicas), peso,
 * pureza, valor de face, quantidade. Os demais campos de collection_items
 * (mint, unit_cost_override, description, location, tags) já existem no
 * banco (Etapa 4) mas não têm UI ainda — permanecem null nesta versão,
 * sem perda de dado futuro.
 *
 * `secondaryMetalCode`: `null` = moeda monometálica. Preenchido = moeda
 * bimetálica (ex.: núcleo de um metal, anel de outro). A coluna
 * `secondary_metal_code` já existe no banco desde a Etapa 4 — só não
 * tinha UI até agora. Trimetálicas não são representáveis com o schema
 * atual (só 2 colunas de metal); ficaria para uma etapa futura.
 *
 * Conservação não é mais um campo do item (Etapa collection_units): é
 * propriedade de cada exemplar físico (`collection_units.grade_id`),
 * porque duas unidades da mesma emissão podem ter conservações
 * diferentes. `initialGradeId` só se aplica na criação — vira a
 * conservação de todos os exemplares criados junto com o item; em
 * edições que aumentam `quantity`, os exemplares novos nascem sem
 * conservação (o usuário define depois, por exemplar).
 *
 * `quantity`: na criação, é o número de exemplares a criar. Na edição,
 * só pode ser >= à quantidade atual (reduzir exige excluir exemplares
 * individualmente — ver features/collection-units) — quem impõe isso é
 * o repositório, não esta tipagem.
 *
 * `purchase` é opcional: se preenchido, o repositório cria (ou atualiza,
 * se o item já tiver uma) a compra vinculada; se null, o item não
 * tem/mantém aquisição registrada. Nunca inclui `purchaseId` nem
 * `userId` — quem resolve isso é o repositório, nunca a UI.
 */
export interface CollectionItemInput {
  countryCode: string | null
  year: number | null
  denomination: string | null
  metalCode: string | null
  secondaryMetalCode: string | null
  grossWeightG: number | null
  purity: number | null
  faceValue: number | null
  quantity: number
  initialGradeId: string | null
  purchase: PurchaseInput | null
}

export interface Country {
  code: string
  name: string
  flagEmoji: string | null
}

export interface Metal {
  code: string
  name: string
  isPrecious: boolean
}

export interface Grade {
  id: string
  scale: string
  code: string
  label: string
  sortOrder: number
}
