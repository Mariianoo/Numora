/**
 * features/billing/repositories/plan-interest.repository.ts
 * Etapa "5.10S — Pro Interest / Pré-lançamento" — captura de intenção de
 * pagamento durante o Beta Fechado. Clona deliberadamente o padrão de
 * `features/feedback/repositories/feedback.repository.ts`: `user_id`
 * NUNCA é enviado pelo client — sempre resolvido de
 * `supabase.auth.getUser()` (RLS `plan_interest_insert_own`/
 * `plan_interest_select_own` exigem `user_id = auth.uid()`).
 *
 * IDEMPOTÊNCIA: `register()` nunca lança ao tentar registrar um interesse
 * já existente — a UNIQUE(user_id, plan_slug) do banco (não uma checagem
 * prévia em 2 passos, que teria uma race condition sob duplo clique) é
 * quem garante "no máximo uma linha por usuário+plano"; um erro Postgres
 * 23505 (unique_violation) é tratado aqui como sucesso idempotente, nunca
 * repassado ao chamador como falha.
 *
 * Nunca chama Stripe, nunca inicia Checkout, nunca lê/altera billing —
 * este repository só conhece a tabela `plan_interest`.
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { PAID_PLAN_SLUGS, type PaidPlanSlug } from '@/lib/stripe/catalog'

const UNIQUE_VIOLATION_ERROR_CODE = '23505'

export interface RegisterPlanInterestInput {
  planSlug: string
  /** Reaproveita o mesmo `UpgradeViewedTrigger` já usado por `upgrade_viewed`/`checkout_started` (lib/analytics/events/paywall-events.ts) — nunca uma taxonomia paralela. */
  source: string | null
}

export interface PlanInterestStatus {
  registered: boolean
}

export interface PlanInterestRepository {
  /** Idempotente: se o usuário já registrou interesse neste plano, devolve `{ registered: true }` sem criar duplicata e sem lançar. */
  register(input: RegisterPlanInterestInput): Promise<PlanInterestStatus>
  /** Estado atual — usado para refletir "Você está na lista de interesse" já ao abrir o diálogo, sem esperar um novo clique. */
  getStatus(planSlug: PaidPlanSlug): Promise<PlanInterestStatus>
}

function isPaidPlanSlug(value: string): value is PaidPlanSlug {
  return (PAID_PLAN_SLUGS as readonly string[]).includes(value)
}

export function createSupabasePlanInterestRepository(): PlanInterestRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async register({ planSlug, source }) {
      if (!isPaidPlanSlug(planSlug)) {
        throw new Error(`[PlanInterestRepository] plan_slug inválido: "${planSlug}".`)
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[PlanInterestRepository] Nenhum usuário logado para registrar interesse.')
      }

      const { error } = await supabase.from('plan_interest').insert({
        user_id: user.id,
        plan_slug: planSlug,
        source,
      })

      if (error) {
        if (error.code === UNIQUE_VIOLATION_ERROR_CODE) {
          return { registered: true }
        }
        throw new Error(`[PlanInterestRepository] Falha ao registrar interesse: ${error.message}`)
      }

      return { registered: true }
    },

    async getStatus(planSlug) {
      const { data, error } = await supabase.from('plan_interest').select('id').eq('plan_slug', planSlug).maybeSingle()

      if (error) {
        throw new Error(`[PlanInterestRepository] Falha ao verificar interesse: ${error.message}`)
      }

      return { registered: data !== null }
    },
  }
}
