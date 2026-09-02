/**
 * features/collection/repositories/reference.repository.ts
 * Infrastructure layer para as tabelas de referência que alimentam o
 * formulário de coleção (countries, metals, grades) — somente leitura;
 * RLS dessas tabelas não permite escrita a usuários (Etapa 1).
 *
 * Countries 2.0 — `countries` agora cobre geografia moderna completa
 * (Estados soberanos + territórios/dependências + regiões especiais,
 * coluna `type`), porque o Cadastro de moeda precisa de todo esse
 * universo (uma moeda pode ter sido emitida por Hong Kong, Bermudas
 * etc., não só por um Estado soberano). Residência de usuário
 * (Perfil/Cadastro) é um caso de uso DIFERENTE — só faz sentido
 * `sovereign_state` — por isso `listResidenceCountries()` existe como
 * método dedicado, nunca um parâmetro escondido em `listCountries()`.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Country, Metal, Grade } from '@/features/collection/types'

export interface ReferenceRepository {
  /** Geografia moderna completa (todos os `type`) — usado pelo Cadastro de moeda. */
  listCountries(): Promise<Country[]>
  /** Só `type = 'sovereign_state'` — usado por Perfil/Cadastro do usuário (residência). */
  listResidenceCountries(): Promise<Country[]>
  listMetals(): Promise<Metal[]>
  listGrades(): Promise<Grade[]>
}

interface CountryRow {
  code: string
  name: string
  flag_emoji: string | null
}

interface MetalRow {
  code: string
  name: string
  is_precious: boolean
}

interface GradeRow {
  id: string
  scale: string
  code: string
  label: string
  sort_order: number
}

export function createSupabaseReferenceRepository(): ReferenceRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async listCountries() {
      const { data, error } = await supabase.from('countries').select('*').order('name')

      if (error) {
        throw new Error(`[ReferenceRepository] Falha ao listar países: ${error.message}`)
      }

      return (data as CountryRow[]).map((row) => ({
        code: row.code,
        name: row.name,
        flagEmoji: row.flag_emoji,
      }))
    },

    async listResidenceCountries() {
      const { data, error } = await supabase.from('countries').select('*').eq('type', 'sovereign_state').order('name')

      if (error) {
        throw new Error(`[ReferenceRepository] Falha ao listar países de residência: ${error.message}`)
      }

      return (data as CountryRow[]).map((row) => ({
        code: row.code,
        name: row.name,
        flagEmoji: row.flag_emoji,
      }))
    },

    async listMetals() {
      const { data, error } = await supabase.from('metals').select('*').order('name')

      if (error) {
        throw new Error(`[ReferenceRepository] Falha ao listar metais: ${error.message}`)
      }

      return (data as MetalRow[]).map((row) => ({
        code: row.code,
        name: row.name,
        isPrecious: row.is_precious,
      }))
    },

    async listGrades() {
      const { data, error } = await supabase.from('grades').select('*').order('scale').order('sort_order')

      if (error) {
        throw new Error(`[ReferenceRepository] Falha ao listar graus de conservação: ${error.message}`)
      }

      return (data as GradeRow[]).map((row) => ({
        id: row.id,
        scale: row.scale,
        code: row.code,
        label: row.label,
        sortOrder: row.sort_order,
      }))
    },
  }
}
