/**
 * features/collection/repositories/export-entitlement.repository.ts
 * Etapa "5.10U — Exportação da Coleção" — `isEnabled()` é SÓ UX (decide se
 * o clique em "Exportar coleção" gera o arquivo ou abre o Paywall), mesmo
 * padrão de `features/labels/repositories/labels.repository.ts`.
 * `get_my_entitlement('exports')` já existe (Etapa 15.8-R2/5.10U —
 * feature_key populado por `20260915154716_exports_entitlement.sql`),
 * nenhuma RPC nova para isto. A barreira REAL de dado continua sendo a RLS
 * de `collection_items`/`collection_units`/`purchases` (ownership,
 * inalterada) — este entitlement nunca decide QUAIS dados existem, só SE o
 * botão gera o arquivo.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export interface ExportEntitlementRepository {
  isEnabled(): Promise<boolean>
}

export function createSupabaseExportEntitlementRepository(): ExportEntitlementRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async isEnabled() {
      const { data, error } = await supabase.rpc('get_my_entitlement', { p_feature_key: 'exports' }).single()

      if (error) {
        throw new Error(`[ExportEntitlementRepository] Falha ao consultar entitlement: ${error.message}`)
      }

      return (data as { enabled: boolean } | null)?.enabled ?? false
    },
  }
}
