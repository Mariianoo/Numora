/**
 * features/passport/types.ts
 * Tipagens do lado de LEITURA PÚBLICA do Passport (Passport V1) —
 * `/passport/[username]` e `/explore`. Espelham exatamente o que as RPCs
 * `get_public_passport`/`list_public_passports` devolvem, nunca mais —
 * nenhum campo aqui deve ser adicionado sem a RPC correspondente já o
 * retornar (essas RPCs são a única fonte de leitura pública; ver
 * PROJECT_RULES.md / auditoria do Passport).
 *
 * Deliberadamente sem `id`/uuid do perfil ou da moeda: as RPCs nunca
 * devolvem esses valores para uma sessão anônima, então não há por que
 * este tipo prever um campo que nunca existirá em runtime.
 *
 * Também sem `numoraId` (ajuste pré-commit do Passport V1): username já
 * identifica publicamente o colecionador, e o Numora ID é sequencial —
 * expô-lo revelaria ordem de cadastro/volume de usuários sem necessidade.
 * A coluna `profiles.numora_id` continua existindo normalmente; só as RPCs
 * públicas pararam de devolvê-la.
 */

/** Uma moeda pública, dentro de `PublicPassport.coins` — nunca dado financeiro (preço/custo/vendedor não existem aqui). */
export interface PublicPassportCoin {
  countryCode: string | null
  countryName: string | null
  countryFlagEmoji: string | null
  year: number | null
  denomination: string | null
  metalName: string | null
  secondaryMetalName: string | null
  quantity: number
  /**
   * Etapa "F5 — Passport V2 Visual" — `get_public_passport` estendida
   * (migration `20260905100000_add_label_code_to_public_passport.sql`,
   * aplicada em DEV) para devolver esta chave. A RPC só LÊ
   * `collection_items.label_code` — nunca gera etiqueta, nunca chama
   * `ensure_label_codes`. `null` até a primeira geração de etiqueta deste
   * item. Mesmo texto já impresso na etiqueta física — nunca um
   * identificador novo, nunca substitui o UUID interno usado no QR.
   */
  labelCode: string | null
  /**
   * Fundação de imagens — path relativo no bucket PÚBLICO
   * `coin-images-public` (nunca no bucket privado `coin-images`), só
   * preenchido quando o dono publicou explicitamente a foto (independente
   * do texto da moeda já estar público). `null` = sem foto pública; a
   * página resolve a URL pública via `getPublicUrl`, nunca recebe a URL
   * pronta da RPC (evita hardcodear domínio do Storage num retorno de
   * banco).
   */
  photoStoragePath: string | null
}

/** Retorno de `get_public_passport(p_username)` — `null` quando o username não existe OU quando existe mas é privado (a página nunca diferencia os dois casos). */
export interface PublicPassport {
  name: string | null
  username: string
  avatarUrl: string | null
  countryCode: string | null
  countryName: string | null
  countryFlagEmoji: string | null
  collectorSince: string
  totalCoins: number
  totalUnits: number
  countriesCount: number
  metalsCount: number
  minYear: number | null
  maxYear: number | null
  /** 'none'/'all'/'selected' — só informa como `coins` foi montada; a UI trata `coins.length === 0` da mesma forma em qualquer um dos 3 casos (nunca revela qual modo está ativo). */
  collectionVisibility: 'none' | 'all' | 'selected'
  coins: PublicPassportCoin[]
}

/** Uma entrada da listagem de `/explore` — retorno de `list_public_passports`. */
export interface PublicPassportListEntry {
  name: string | null
  username: string
  avatarUrl: string | null
  countryCode: string | null
  countryName: string | null
  countryFlagEmoji: string | null
  collectorSince: string
  totalCoins: number
  countriesCount: number
}

export interface PublicPassportListPage {
  entries: PublicPassportListEntry[]
  hasMore: boolean
}

/**
 * Etapa "F4 — Numora Labels" — retorno de `get_public_passport_item(username, itemId)`,
 * o Passport público de UMA moeda (alvo do QR Code impresso na etiqueta).
 * Mesma disciplina de `PublicPassport`: nenhum dado financeiro/privado,
 * `null` para qualquer motivo de indisponibilidade (username inexistente,
 * Passport privado, item inexistente/de outro usuário/excluído/fora da
 * visibilidade selecionada), sem diferenciar qual.
 *
 * `coin` é aninhado (não plano) de propósito: `countryCode`/`countryName`/
 * `countryFlagEmoji` existem tanto no colecionador (país dele) quanto na
 * moeda (país de cunhagem) — a RPC evita a colisão de nomes aninhando o
 * item em vez de renomear campos já usados em `PublicPassportCoin`.
 *
 * `coin.labelCode` não existe em `PublicPassportCoin` — ao contrário do
 * `numoraId` do perfil (removido do Passport agregado por revelar
 * ordem/volume de cadastro), o `labelCode` de um item já está impresso na
 * própria etiqueta física que levou à leitura do QR.
 */
export interface PublicPassportItem {
  name: string | null
  username: string
  avatarUrl: string | null
  countryCode: string | null
  countryName: string | null
  countryFlagEmoji: string | null
  collectorSince: string
  coin: {
    labelCode: string | null
    countryCode: string | null
    countryName: string | null
    countryFlagEmoji: string | null
    year: number | null
    denomination: string | null
    metalName: string | null
    secondaryMetalName: string | null
    quantity: number
    photoStoragePath: string | null
  }
}
