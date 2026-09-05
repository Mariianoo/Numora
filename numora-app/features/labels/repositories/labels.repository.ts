/**
 * features/labels/repositories/labels.repository.ts
 * Infrastructure layer do Numora Labels (Etapa "F4 — Numora Labels").
 *
 * `isEnabled()` é SÓ UX (decide se mostra o gerador ou o card de upgrade) —
 * `get_my_entitlement('labels')` já existe (Etapa 15.8-R2), nenhuma RPC
 * nova para isto. A barreira REAL é `ensureLabelCodes()`, que chama
 * `ensure_label_codes()` (SECURITY DEFINER, fail-closed) — um usuário Free
 * chamando este método recebe o erro 42501 propagado como `Error`, nunca
 * um retorno silencioso vazio.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { LabelsRepository } from '../types'

export function createSupabaseLabelsRepository(): LabelsRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async isEnabled() {
      const { data, error } = await supabase.rpc('get_my_entitlement', { p_feature_key: 'labels' }).single()

      if (error) {
        throw new Error(`[LabelsRepository] Falha ao consultar entitlement: ${error.message}`)
      }

      return (data as { enabled: boolean } | null)?.enabled ?? false
    },

    async ensureLabelCodes(itemIds) {
      if (itemIds.length === 0) return {}

      const { data, error } = await supabase.rpc('ensure_label_codes', { p_item_ids: itemIds })

      if (error) {
        throw new Error(`[LabelsRepository] Falha ao gerar identificador de etiqueta: ${error.message}`)
      }

      const result: Record<string, string> = {}
      for (const row of data as { item_id: string; label_code: string }[]) {
        result[row.item_id] = row.label_code
      }
      return result
    },
  }
}
