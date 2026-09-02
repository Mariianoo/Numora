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
