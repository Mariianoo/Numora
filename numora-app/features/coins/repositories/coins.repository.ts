/**
 * features/coins/repositories/coins.repository.ts
 * Infrastructure layer da feature de coleção de moedas (PROJECT_RULES.md
 * §4.2, DEVELOPMENT_GUIDE.md §14) — única camada que sabe o nome da tabela
 * `coins` e de suas colunas. Associa toda escrita ao usuário logado
 * (`auth.uid()`), nunca recebendo `userId` de fora.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { COIN_LIMIT_REACHED_MESSAGE } from '@/features/coins/constants'
import type { Coin, NewCoinInput } from '@/features/coins/types'

/** Código Postgres para violação de RLS (`WITH CHECK`) em INSERT. */
const RLS_VIOLATION_CODE = '42501'

export interface CoinsRepository {
  list(): Promise<Coin[]>
  create(input: NewCoinInput): Promise<Coin>
  remove(id: string): Promise<void>
}

interface CoinRow {
  id: string
  user_id: string
  country: string
  year: number | null
  value: number | null
  description: string | null
  image_url: string | null
  price_paid: number | null
  created_at: string
}

function toCoin(row: CoinRow): Coin {
  return {
    id: row.id,
    userId: row.user_id,
    country: row.country,
    year: row.year,
    value: row.value,
    description: row.description,
    imageUrl: row.image_url,
    pricePaid: row.price_paid,
    createdAt: row.created_at,
  }
}

export function createSupabaseCoinsRepository(): CoinsRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async list() {
      const { data, error } = await supabase
        .from('coins')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`[CoinsRepository] Falha ao listar moedas: ${error.message}`)
      }

      return (data as CoinRow[]).map(toCoin)
    },

    async create(input) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[CoinsRepository] Nenhum usuário logado para associar a moeda.')
      }

      const { data, error } = await supabase
        .from('coins')
        .insert({
          user_id: user.id,
          country: input.country,
          year: input.year,
          value: input.value,
          description: input.description,
          price_paid: input.pricePaid,
        })
        .select('*')
        .single()

      if (error) {
        // A policy `coins_insert_own` também nega o insert quando o
        // usuário já tem 50 moedas (limite do plano free) — mesmo código
        // de erro de qualquer outra violação de RLS, mas como esta é a
        // única regra além do dono do registro, é seguro tratar como o
        // limite atingido aqui.
        if (error.code === RLS_VIOLATION_CODE) {
          throw new Error(COIN_LIMIT_REACHED_MESSAGE)
        }
        throw new Error(`[CoinsRepository] Falha ao adicionar moeda: ${error.message}`)
      }

      return toCoin(data as CoinRow)
    },

    async remove(id) {
      const { error } = await supabase.from('coins').delete().eq('id', id)

      if (error) {
        throw new Error(`[CoinsRepository] Falha ao excluir moeda: ${error.message}`)
      }
    },
  }
}
