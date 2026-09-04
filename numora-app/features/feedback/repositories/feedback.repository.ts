/**
 * features/feedback/repositories/feedback.repository.ts
 * Infrastructure layer do lado DO USUÁRIO da Central de Feedback (Etapa
 * "F3 — Numora Feedback", PROJECT_RULES.md §4.2) — única camada que sabe
 * o nome da tabela `feedbacks` para o caminho não-administrativo.
 *
 * `create()` nunca envia `userId` (RLS `feedbacks_insert_own` exige
 * `user_id = auth.uid()` — o valor vem da sessão, resolvido aqui, nunca
 * aceito de fora). Validação de formato acontece ANTES do INSERT
 * (`validateFeedbackInput`) — feedback antecipado; o CHECK do banco é
 * quem realmente impede um `title`/`message` vazio ou um `type` inválido,
 * mesmo se este método fosse contornado.
 *
 * `listOwn()` existe para o usuário poder, no futuro, ver o próprio
 * histórico (RLS `feedbacks_select_own` já permite) — nenhuma UI desta
 * etapa a chama ainda, mas o caminho existe e é testável isoladamente
 * (nunca escrever SQL direto num componente React só para isso depois).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { validateFeedbackInput } from '@/features/feedback/validation'
import type { CreateFeedbackInput, Feedback } from '@/features/feedback/types'

export interface FeedbackRepository {
  create(input: CreateFeedbackInput): Promise<Feedback>
  /** Só os feedbacks do usuário logado, mais recentes primeiro (RLS `feedbacks_select_own`). */
  listOwn(): Promise<Feedback[]>
}

const FEEDBACK_SELECT =
  'id, user_id, type, title, message, wants_contact, status, priority, created_at, updated_at'

interface FeedbackRow {
  id: string
  user_id: string
  type: Feedback['type']
  title: string
  message: string
  wants_contact: boolean
  status: Feedback['status']
  priority: Feedback['priority']
  created_at: string
  updated_at: string
}

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    wantsContact: row.wants_contact,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSupabaseFeedbackRepository(): FeedbackRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async create(input) {
      const validationError = validateFeedbackInput(input)
      if (validationError) {
        throw new Error(validationError)
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('[FeedbackRepository] Nenhum usuário logado para enviar feedback.')
      }

      const { data, error } = await supabase
        .from('feedbacks')
        .insert({
          user_id: user.id,
          type: input.type,
          title: input.title.trim(),
          message: input.message.trim(),
          wants_contact: input.wantsContact,
        })
        .select(FEEDBACK_SELECT)
        .single()

      if (error) {
        throw new Error(`[FeedbackRepository] Falha ao enviar feedback: ${error.message}`)
      }

      return toFeedback(data as FeedbackRow)
    },

    async listOwn() {
      const { data, error } = await supabase
        .from('feedbacks')
        .select(FEEDBACK_SELECT)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`[FeedbackRepository] Falha ao listar feedbacks: ${error.message}`)
      }

      return (data as FeedbackRow[]).map(toFeedback)
    },
  }
}
