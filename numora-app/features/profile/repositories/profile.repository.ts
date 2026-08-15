/**
 * features/profile/repositories/profile.repository.ts
 * Infrastructure layer da feature de perfil (PROJECT_RULES.md §4.2) —
 * única camada que sabe o nome da tabela `profiles` e de suas colunas
 * para esta feature. Ownership sempre resolvido via sessão
 * (`supabase.auth.getUser()`) — nunca aceita `user_id`/`id` de fora.
 *
 * `updateOwnProfile()` só aceita os 3 campos de `ProfileUpdateInput`
 * (name, username, countryCode) — mesmo que o caller tentasse passar
 * `role`/`plan_tier`/`numora_id`/`email`, o tipo TypeScript já impede
 * isso em tempo de compilação. E mesmo que alguém chamasse a API do
 * Supabase diretamente (fora deste repositório) tentando alterar esses
 * campos, o banco já bloqueia: não há GRANT UPDATE nessas colunas para
 * `authenticated` (confirmado por introspecção antes desta etapa), e
 * `numora_id` tem ainda o trigger `protect_numora_id`. A proteção real é
 * do banco — este repositório só existe para não expor esses campos como
 * opção de edição na camada de aplicação.
 *
 * `isUsernameAvailable` NÃO existe aqui de propósito: a RLS de `profiles`
 * (`profiles_select_own`) só permite ler a própria linha — uma consulta
 * "esse username já existe?" contra outro usuário sempre retornaria "não
 * encontrado" (falso "disponível"), mesmo quando já está em uso. Uma
 * pré-checagem confiável exigiria uma function/policy nova (fora do
 * escopo desta etapa — não altera RLS/migrations). A verificação de
 * unicidade real acontece no momento do salvar, via a UNIQUE constraint
 * do banco (`uq_profiles_username`) — capturamos o erro de conflito
 * (Postgres 23505) e devolvemos uma mensagem clara.
 *
 * Estatísticas (`getOwnStats`): lê `collection_items`/`purchases`
 * (somente leitura, nunca escreve) usando exatamente o mesmo cálculo do
 * Dashboard (`computeCollectionStats`, Etapa 8.1) — não duplica a
 * lógica, só troca a origem do client (browser em vez de servidor).
 *
 * `setPassportPublic` (Etapa 8.2): método dedicado, separado de
 * `updateOwnProfile`, para deixar essa ação sensível auditável
 * isoladamente. Ao ativar (`true`), checa `username` antes de tentar —
 * mas a garantia real é do banco: `CHECK
 * chk_profiles_passport_requires_username` (migration
 * `add_passport_public_username_check`) rejeita qualquer tentativa de
 * `passport_public = true` com `username` nulo, mesmo vinda de fora
 * deste repositório. A leitura pública do Passport (`/passport/[username]`)
 * não passa por aqui — é a RPC `get_public_passport`, chamada
 * diretamente pela página (Server Component), sem repositório.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Profile, ProfileUpdateInput } from '@/features/profile/types'
import { normalizeUsername, validateUsernameFormat } from '@/features/profile/username'
import { computeCollectionStats, type CollectionItemStatsRow, type PurchaseStatsRow, type CollectionStats } from '@/lib/stats/collection-stats'

export interface ProfileRepository {
  getOwnProfile(): Promise<Profile>
  updateOwnProfile(input: ProfileUpdateInput): Promise<Profile>
  getOwnStats(): Promise<CollectionStats>
  setPassportPublic(value: boolean): Promise<Profile>
}

const PASSPORT_REQUIRES_USERNAME_MESSAGE = 'Defina um nome de usuário antes de ativar seu Passport público.'

const PROFILE_SELECT =
  'id, numora_id, email, name, username, avatar_url, country_code, plan_tier, passport_public, collector_since, created_at'

interface ProfileRow {
  id: string
  numora_id: string
  email: string | null
  name: string | null
  username: string | null
  avatar_url: string | null
  country_code: string | null
  plan_tier: 'free' | 'premium'
  passport_public: boolean
  collector_since: string
  created_at: string
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    numoraId: row.numora_id,
    email: row.email,
    name: row.name,
    username: row.username,
    avatarUrl: row.avatar_url,
    countryCode: row.country_code,
    planTier: row.plan_tier,
    passportPublic: row.passport_public,
    collectorSince: row.collector_since,
    createdAt: row.created_at,
  }
}

export function createSupabaseProfileRepository(): ProfileRepository {
  const supabase = getSupabaseBrowserClient()

  async function requireUserId(): Promise<string> {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      throw new Error('[ProfileRepository] Nenhum usuário logado.')
    }

    return user.id
  }

  async function getOwnProfile(): Promise<Profile> {
    const userId = await requireUserId()

    const { data, error } = await supabase.from('profiles').select(PROFILE_SELECT).eq('id', userId).single()

    if (error) {
      throw new Error(`[ProfileRepository] Falha ao buscar perfil: ${error.message}`)
    }

    return toProfile(data as ProfileRow)
  }

  async function updateOwnProfile(input: ProfileUpdateInput): Promise<Profile> {
    const userId = await requireUserId()

    const normalizedUsername = input.username !== null && input.username.trim() !== '' ? normalizeUsername(input.username) : null

    if (normalizedUsername !== null) {
      const formatError = validateUsernameFormat(normalizedUsername)
      if (formatError) {
        throw new Error(formatError)
      }
    }

    if (normalizedUsername === null) {
      const current = await getOwnProfile()
      if (current.passportPublic) {
        throw new Error(PASSPORT_REQUIRES_USERNAME_MESSAGE)
      }
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        name: input.name?.trim() || null,
        username: normalizedUsername,
        country_code: input.countryCode,
      })
      .eq('id', userId)
      .select(PROFILE_SELECT)
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new Error('Este nome de usuário já está em uso.')
      }
      throw new Error(`[ProfileRepository] Falha ao atualizar perfil: ${error.message}`)
    }

    return toProfile(data as ProfileRow)
  }

  async function getOwnStats(): Promise<CollectionStats> {
    await requireUserId()

    const [itemsResult, purchasesResult] = await Promise.all([
      supabase.from('collection_items').select('quantity, country_code, metal_code').is('deleted_at', null),
      // Mesmo filtro do Dashboard (Etapa Lixeira): só conta purchase com
      // ao menos 1 collection_item ATIVO vinculado — via embed `!inner`,
      // sem N+1, sem duplicar a linha de purchases compartilhadas.
      supabase.from('purchases').select('total_price, collection_items!inner(id)').is('collection_items.deleted_at', null),
    ])

    if (itemsResult.error) {
      throw new Error(`[ProfileRepository] Falha ao calcular estatísticas: ${itemsResult.error.message}`)
    }

    if (purchasesResult.error) {
      throw new Error(`[ProfileRepository] Falha ao calcular estatísticas: ${purchasesResult.error.message}`)
    }

    return computeCollectionStats(
      (itemsResult.data ?? []) as CollectionItemStatsRow[],
      (purchasesResult.data ?? []) as PurchaseStatsRow[],
    )
  }

  async function setPassportPublic(value: boolean): Promise<Profile> {
    const userId = await requireUserId()

    if (value) {
      const current = await getOwnProfile()
      if (!current.username) {
        throw new Error(PASSPORT_REQUIRES_USERNAME_MESSAGE)
      }
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ passport_public: value })
      .eq('id', userId)
      .select(PROFILE_SELECT)
      .single()

    if (error) {
      if (error.code === '23514') {
        throw new Error(PASSPORT_REQUIRES_USERNAME_MESSAGE)
      }
      throw new Error(`[ProfileRepository] Falha ao atualizar visibilidade do Passport: ${error.message}`)
    }

    return toProfile(data as ProfileRow)
  }

  return { getOwnProfile, updateOwnProfile, getOwnStats, setPassportPublic }
}
