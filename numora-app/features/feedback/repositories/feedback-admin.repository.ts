/**
 * features/feedback/repositories/feedback-admin.repository.ts
 * Infrastructure layer do lado ADMIN da Central de Feedback (Etapa "F3 —
 * Numora Feedback"). Separado de `feedback.repository.ts` de propósito —
 * mesma razão de `features/admin/repositories/admin.repository.ts` existir
 * à parte dos repositories de usuário comum: são operações que só fazem
 * sentido para quem tem `is_platform_admin()`, com efeitos colaterais
 * próprios (auditoria).
 *
 * NENHUMA checagem de role em código — a RLS (`feedbacks_select_admin`/
 * `feedbacks_update_admin`, ambas `is_platform_admin()`) é a única barreira
 * real. Se um usuário sem a role chamar qualquer método daqui, o Postgres
 * recusa (a policy simplesmente não retorna/não afeta linhas) — mesmo
 * princípio documentado em `admin.repository.ts`.
 *
 * `updateAdmin()` sempre registra a mudança via `log_admin_action()` (RPC
 * já existente, Etapa 15.3) — mesmo padrão de `grantCourtesy`/
 * `revokeActiveCourtesy`: toda mutação administrativa deixa rastro
 * imutável em `admin_audit_logs`. `target_user_id` é o AUTOR do feedback
 * (quem foi afetado pela mudança), não o admin que a fez (esse já é
 * `actor_user_id`, resolvido dentro da própria RPC via `auth.uid()`).
 */
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AdminFeedback, Feedback, UpdateFeedbackAdminInput } from '@/features/feedback/types'

export interface FeedbackAdminRepository {
  /** Todos os feedbacks (RLS `feedbacks_select_admin`), mais recentes primeiro, com dados de exibição do autor. */
  list(): Promise<AdminFeedback[]>
  updateAdmin(id: string, input: UpdateFeedbackAdminInput): Promise<Feedback>
}

// `feedback_admin_notes ( notes )` — embed via FK (`feedback_admin_notes.feedback_id
// -> feedbacks.id`), mesmo padrão de `profiles ( email, name, username )` logo abaixo.
// RLS de `feedback_admin_notes` só permite is_platform_admin(): se este select
// rodasse para um usuário comum (não deveria, feedbacks_select_admin já barra a
// linha inteira), o embed viria vazio, nunca com a nota de outra pessoa.
const ADMIN_FEEDBACK_SELECT =
  'id, user_id, type, title, message, wants_contact, status, priority, created_at, updated_at, profiles ( email, name, username ), feedback_admin_notes ( notes )'

interface AdminFeedbackRow {
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
  profiles: { email: string | null; name: string | null; username: string | null } | null
  feedback_admin_notes: { notes: string | null } | { notes: string | null }[] | null
}

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

/** `feedback_admin_notes` é 1:1 (PK = feedback_id), mas o PostgREST pode devolver o embed como objeto único ou array de 1 dependendo da FK detectada — trata os dois formatos. */
function extractAdminNotes(embed: AdminFeedbackRow['feedback_admin_notes']): string | null {
  if (!embed) return null
  const row = Array.isArray(embed) ? embed[0] : embed
  return row?.notes ?? null
}

function toAdminFeedback(row: AdminFeedbackRow): AdminFeedback {
  return {
    ...toFeedback(row),
    userEmail: row.profiles?.email ?? null,
    userName: row.profiles?.name ?? null,
    userUsername: row.profiles?.username ?? null,
    adminNotes: extractAdminNotes(row.feedback_admin_notes),
  }
}

export function createSupabaseFeedbackAdminRepository(): FeedbackAdminRepository {
  const supabase = getSupabaseBrowserClient()

  return {
    async list() {
      const { data, error } = await supabase
        .from('feedbacks')
        .select(ADMIN_FEEDBACK_SELECT)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`[FeedbackAdminRepository] Falha ao listar feedbacks: ${error.message}`)
      }

      return (data as unknown as AdminFeedbackRow[]).map(toAdminFeedback)
    },

    async updateAdmin(id, input) {
      const payload: Record<string, unknown> = {}
      if (input.status !== undefined) payload.status = input.status
      if (input.priority !== undefined) payload.priority = input.priority

      let updated: Feedback

      // status/priority vivem em `feedbacks`; `admin_notes` vive em
      // `feedback_admin_notes` (tabela separada, RLS só is_platform_admin() —
      // ver comentário do topo do arquivo). Um único `.update(payload)` como
      // antes não é mais possível porque não é a mesma tabela.
      if (Object.keys(payload).length > 0) {
        const { data, error } = await supabase
          .from('feedbacks')
          .update(payload)
          .eq('id', id)
          .select('id, user_id, type, title, message, wants_contact, status, priority, created_at, updated_at')
          .single()

        if (error) {
          throw new Error(`[FeedbackAdminRepository] Falha ao atualizar feedback: ${error.message}`)
        }

        updated = toFeedback(data as FeedbackRow)
      } else {
        const { data, error } = await supabase
          .from('feedbacks')
          .select('id, user_id, type, title, message, wants_contact, status, priority, created_at, updated_at')
          .eq('id', id)
          .single()

        if (error) {
          throw new Error(`[FeedbackAdminRepository] Falha ao carregar feedback: ${error.message}`)
        }

        updated = toFeedback(data as FeedbackRow)
      }

      if (input.adminNotes !== undefined) {
        const { error: notesError } = await supabase
          .from('feedback_admin_notes')
          .upsert({ feedback_id: id, notes: input.adminNotes }, { onConflict: 'feedback_id' })

        if (notesError) {
          throw new Error(`[FeedbackAdminRepository] Falha ao salvar observação interna: ${notesError.message}`)
        }
      }

      const { error: logError } = await supabase.rpc('log_admin_action', {
        p_action: 'feedback.update',
        p_target_user_id: updated.userId,
        p_metadata: { feedback_id: id, ...input },
      })

      if (logError) {
        throw new Error(`[FeedbackAdminRepository] Feedback atualizado, mas falha ao registrar auditoria: ${logError.message}`)
      }

      return updated
    },
  }
}
