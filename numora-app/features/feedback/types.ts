/**
 * features/feedback/types.ts
 * Tipagens de domínio da Central de Feedback (Etapa "F3 — Numora
 * Feedback"). Espelham exatamente os CHECK constraints da migration
 * `create_feedbacks.sql` — nenhum valor aqui deve existir sem o banco
 * também aceitá-lo.
 */

export type FeedbackType = 'praise' | 'suggestion' | 'problem'
export type FeedbackStatus = 'new' | 'reviewing' | 'planned' | 'in_progress' | 'completed' | 'dismissed'
export type FeedbackPriority = 'low' | 'medium' | 'high' | 'critical'

export interface Feedback {
  id: string
  userId: string
  type: FeedbackType
  title: string
  message: string
  wantsContact: boolean
  status: FeedbackStatus
  priority: FeedbackPriority
  createdAt: string
  updatedAt: string
}

/** Payload de `FeedbackRepository.create()` — nunca inclui `userId` (resolvido no servidor/RLS via sessão) nem os campos administrativos. */
export interface CreateFeedbackInput {
  type: FeedbackType
  title: string
  message: string
  wantsContact: boolean
}

/**
 * Feedback com dados de exibição do autor, resolvidos via o mesmo FK
 * (`feedbacks.user_id -> profiles.id`) que a RLS `feedbacks_select_admin`
 * já permite ao admin ler — nenhuma RPC nova, só um embed do PostgREST.
 * Nunca inclui e-mail de outra fonte que não `profiles.email` (já
 * declarado como dado tratado na Política de Privacidade).
 *
 * `adminNotes` só existe aqui, nunca em `Feedback` — vive fisicamente numa
 * tabela separada (`feedback_admin_notes`), com RLS restrita a
 * `is_platform_admin()`. Colocá-la na base `Feedback` reintroduziria o
 * mesmo risco que motivou a tabela separada: qualquer código que ler um
 * `Feedback` "genérico" (inclusive o repositório do usuário comum, ou uma
 * chamada direta à API/Supabase feita pelo próprio autor) passaria a
 * carregar um campo que deveria ser exclusivo do admin.
 */
export interface AdminFeedback extends Feedback {
  userEmail: string | null
  userName: string | null
  userUsername: string | null
  adminNotes: string | null
}

/** Payload de `FeedbackAdminRepository.updateAdmin()` — só os 3 campos que a RLS `feedbacks_update_admin` permite alterar. */
export interface UpdateFeedbackAdminInput {
  status?: FeedbackStatus
  priority?: FeedbackPriority
  adminNotes?: string | null
}
