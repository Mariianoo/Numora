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

/**
 * Uma entrada de catalogação (Etapa 11) — ex.: `{ catalog: 'KM', code:
 * '649' }`. `jsonb` no banco (`collection_items.catalog_references`),
 * array de objetos com este shape validado aqui em TypeScript; o banco só
 * garante que é um array (`jsonb_typeof = 'array'`), não o shape interno.
 */
export interface CatalogReference {
  /** Nome do sistema de catalogação — ex.: "KM", "Numista", "NGC", "PCGS". Texto livre, não é um enum fechado. */
  catalog: string
  /** Código dentro daquele catálogo — ex.: "649", "N#12345". */
  code: string
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
   *
   * NÃO confundir com `mintage` (quantidade cunhada historicamente pela
   * casa da moeda) — são conceitos completamente diferentes: `quantity`
   * é "quantos exemplares EU tenho", `mintage` é "quantos foram
   * fabricados no total" (Etapa 11).
   */
  quantity: number
  unitCostOverride: number | null
  description: string | null
  location: string | null
  tags: string[] | null
  /**
   * Quantidade cunhada historicamente (Etapa 11) — `string`, NUNCA
   * `number`: é um `bigint` no Postgres (mintagens reais chegam a
   * bilhões) e o repository o lê via `mintage::text` no PostgREST
   * especificamente para evitar que o JSON.parse do JavaScript corrompa
   * valores acima de `Number.MAX_SAFE_INTEGER` (comprovado em teste real
   * nesta etapa: 9007199254740993 virava 9007199254740992 sem o cast).
   * Formatar para exibição sem passar por `Number()`; usar `BigInt(str)`
   * se precisar agrupar milhares, nunca `parseInt`/`Number`.
   */
  mintage: string | null
  /** História da emissão (Etapa 11) — texto livre, pertence à emissão, nunca duplicado por exemplar. */
  history: string | null
  /** Curiosidades sobre a emissão (Etapa 11) — texto livre (não lista) de propósito, ver decisão na auditoria: evita UI de itens repetíveis sem necessidade real ainda. */
  trivia: string | null
  /** Referências de catalogação (Etapa 11) — `null` ou array; nunca uma moeda de exemplo/fictícia. */
  catalogReferences: CatalogReference[] | null
  createdAt: string
  updatedAt: string
  /**
   * Etapa Lixeira — `null` = coleção ativa, preenchido = na lixeira.
   * Única fonte de verdade para ativo/lixeira (não existe em
   * `collection_units`/`coin_images` de propósito — a visibilidade deles é
   * inteiramente derivada deste campo no pai, nunca um estado próprio).
   */
  deletedAt: string | null
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
  /**
   * Passport V1 (Fase 3) — só tem efeito quando
   * `profile.passportCollectionVisibility === 'selected'`; nos modos
   * 'none'/'all' este campo existe mas não é consultado por ninguém (a
   * RPC pública decide sozinha o que mostrar, sem depender da UI ler
   * este valor corretamente).
   */
  isPublicInPassport: boolean
  /**
   * Fundação de imagens — publicação EXPLÍCITA e independente de
   * `isPublicInPassport`/modo de visibilidade: controla só se a foto de
   * frente do exemplar principal tem uma derivação pública (com marca
   * d'água) exibida no Passport. Nunca fica `true` automaticamente, nem
   * no modo 'all'.
   */
  isPhotoPublic: boolean
  /**
   * Etapa "F4 — Numora Labels" — identificador humano estável (formato
   * `NMR-0000001`), `null` até a primeira geração de etiqueta deste item.
   * Só atribuído por `ensure_label_codes()` (RPC SECURITY DEFINER) — nunca
   * escrito por este repositório, nunca gerado antecipadamente em massa.
   */
  labelCode: string | null
}

/**
 * Dados do formulário "Adicionar/Editar moeda" — país, ano, denominação,
 * metal (+ segundo metal opcional, para moedas bimetálicas), peso,
 * pureza, valor de face, quantidade. Os demais campos de collection_items
 * (mint, unit_cost_override, description, location, tags) já existem no
 * banco (Etapa 4) mas não têm UI ainda — permanecem null nesta versão,
 * sem perda de dado futuro.
 *
 * Etapa 3B — `metalCode`/`secondaryMetalCode`/`purity` SAÍRAM deste tipo:
 * a partir desta etapa, `create()`/`update()` recebem só os dados gerais
 * do item. Composição (simples, liga, bimetálica, trimetálica, plating ou
 * desconhecida) é responsabilidade exclusiva de
 * `CoinCompositionRepository.setComposition()` (features/coin-composition),
 * chamada separadamente logo após `create()`/`update()`. Os 3 campos
 * continuam existindo em `CollectionItem` (leitura) — são derivados e
 * escritos pela RPC `set_collection_item_composition`, nunca mais por
 * este repository.
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
  grossWeightG: number | null
  faceValue: number | null
  quantity: number
  initialGradeId: string | null
  purchase: PurchaseInput | null
}

/**
 * Dados do modal "Informações da moeda" (Etapa 11) — propositalmente um
 * tipo SEPARADO de `CollectionItemInput`, nunca um subconjunto opcional
 * dele. `CollectionRepository.updateEnrichment()` escreve exatamente (e
 * somente) estes 5 campos — nunca `quantity`, `purchase`, `country_code`,
 * `year`, `metal_code`, etc. Isso existe para que abrir esse modal e
 * salvar NUNCA possa sobrescrever por acidente um dado que pertence ao
 * formulário "Editar moeda" (que o usuário nem tinha aberto).
 * `mintage` é `string | null` pelo mesmo motivo do campo em
 * `CollectionItem`: é um `bigint`, nunca passa por `Number()`.
 */
export interface CollectionItemEnrichmentInput {
  mint: string | null
  mintage: string | null
  history: string | null
  trivia: string | null
  catalogReferences: CatalogReference[] | null
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
  /**
   * Etapa 3B — `element` (metal puro, ex.: prata) ou `alloy` (liga
   * nomeada, ex.: bronze, latão, cuproníquel, aço). Coluna `metals.kind`
   * existe desde a Fundação de composição (Etapa 1); só exposta aqui
   * agora que a UI de composição precisa distinguir os dois para rotular
   * ligas como "Bronze (liga)" no seletor de metal.
   */
  kind: 'element' | 'alloy'
}

export interface Grade {
  id: string
  scale: string
  code: string
  label: string
  sortOrder: number
}
