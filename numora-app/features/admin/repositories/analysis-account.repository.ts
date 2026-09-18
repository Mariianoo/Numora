/**
 * features/admin/repositories/analysis-account.repository.ts
 * Etapa "5.10W.4 — Conta de Análise: Painel Administrativo" — repository
 * FINO: só encapsula chamadas às RPCs já existentes/auditadas
 * (W.1/W.2/W.3) e à nova RPC de leitura de dataset (W.4). Nenhuma regra de
 * negócio de entitlement/billing/plano é reimplementada aqui — a única
 * fonte de verdade continua sendo o banco.
 *
 * `findAnalysisAccountUserId()` é o ÚNICO lugar que sabe consultar
 * `internal_test_accounts` — nunca um `user_id`/e-mail fixo no código.
 * Hoje suporta exatamente 1 Conta de Análise (`limit(1)`); se o produto um
 * dia precisar de mais de uma, este é o único ponto a revisar.
 *
 * Mesmo padrão de `AdminRepository` (client de browser, prefixo
 * `[AnalysisAccountRepository]` nos erros — a tradução para mensagem
 * amigável acontece na UI, nunca aqui, mesmo padrão de todo repository do
 * projeto).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export type AnalysisAccountPlanSlug = 'free' | 'pro' | 'premium'

export interface AnalysisAccountState {
  userId: string
  planSlug: string
  itemCount: number
  countryCount: number
  purchaseCount: number
}

export interface PopulateDatasetResult {
  populated: boolean
  itemCount: number
}

export interface AnalysisAccountRepository {
  /** `null` = nenhuma Conta de Análise configurada ainda (internal_test_accounts vazia). */
  getState(): Promise<AnalysisAccountState | null>
  /** Delegado inteiramente a `switch_analysis_account_plan()` — nunca escreve em benefit_grants diretamente. */
  switchPlan(plan: AnalysisAccountPlanSlug): Promise<void>
  /** Delegado inteiramente a `populate_analysis_account_dataset()`. `populated: false` = já existia, nada foi inserido (idempotente). */
  populateDataset(): Promise<PopulateDatasetResult>
  /** Delegado inteiramente a `reset_analysis_account_dataset()` — nunca um DELETE direto do client. */
  resetDataset(): Promise<void>
}

interface EffectivePlanRow {
  plan_slug: string
}

interface DatasetSummaryRow {
  item_count: number
  country_count: number
  purchase_count: number
}

interface PopulateResultRow {
  populated: boolean
  item_count: number
}

export function createSupabaseAnalysisAccountRepository(): AnalysisAccountRepository {
  const supabase = getSupabaseBrowserClient()

  async function findAnalysisAccountUserId(): Promise<string | null> {
    const { data, error } = await supabase.from('internal_test_accounts').select('user_id').limit(1).maybeSingle()

    if (error) {
      throw new Error(`[AnalysisAccountRepository] Falha ao localizar a Conta de Análise: ${error.message}`)
    }

    return data?.user_id ?? null
  }

  function requireAnalysisAccountUserId(userId: string | null): string {
    if (userId === null) {
      throw new Error('[AnalysisAccountRepository] Nenhuma Conta de Análise configurada ainda.')
    }
    return userId
  }

  return {
    async getState() {
      const userId = await findAnalysisAccountUserId()
      if (userId === null) return null

      const [planResult, summaryResult] = await Promise.all([
        supabase.rpc('get_effective_plan', { p_user_id: userId }).maybeSingle(),
        supabase.rpc('get_analysis_account_dataset_summary', { p_user_id: userId }).maybeSingle(),
      ])

      if (planResult.error) {
        throw new Error(`[AnalysisAccountRepository] Falha ao consultar o plano atual: ${planResult.error.message}`)
      }
      if (summaryResult.error) {
        throw new Error(`[AnalysisAccountRepository] Falha ao consultar o dataset: ${summaryResult.error.message}`)
      }

      const plan = planResult.data as EffectivePlanRow | null
      const summary = summaryResult.data as DatasetSummaryRow | null

      return {
        userId,
        planSlug: plan?.plan_slug ?? 'free',
        itemCount: summary?.item_count ?? 0,
        countryCount: summary?.country_count ?? 0,
        purchaseCount: summary?.purchase_count ?? 0,
      }
    },

    async switchPlan(plan) {
      const userId = requireAnalysisAccountUserId(await findAnalysisAccountUserId())

      const { error } = await supabase.rpc('switch_analysis_account_plan', { p_user_id: userId, p_plan: plan })
      if (error) {
        throw new Error(`[AnalysisAccountRepository] Falha ao trocar o plano: ${error.message}`)
      }
    },

    async populateDataset() {
      const userId = requireAnalysisAccountUserId(await findAnalysisAccountUserId())

      const { data, error } = await supabase.rpc('populate_analysis_account_dataset', { p_user_id: userId }).single()
      if (error) {
        throw new Error(`[AnalysisAccountRepository] Falha ao popular o dataset: ${error.message}`)
      }

      const result = data as PopulateResultRow
      return { populated: result.populated, itemCount: result.item_count }
    },

    async resetDataset() {
      const userId = requireAnalysisAccountUserId(await findAnalysisAccountUserId())

      const { error } = await supabase.rpc('reset_analysis_account_dataset', { p_user_id: userId })
      if (error) {
        throw new Error(`[AnalysisAccountRepository] Falha ao resetar o dataset: ${error.message}`)
      }
    },
  }
}
