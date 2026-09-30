/**
 * lib/auth/pending-signup-cleanup.ts
 * Etapa "B2.4 — Signup server-controlled" — limpeza de cadastros públicos
 * PENDENTES (e-mail nunca confirmado) após 7 dias (decisão de produto).
 *
 * Só remove usuários que passam por DUAS barreiras independentes:
 * 1. a lista do banco (`list_stale_pending_public_signups`): não confirmado,
 *    nunca logou, marcador DURÁVEL do fluxo público em `app_metadata`
 *    (server-only) + nonce do request criador, E uma SEGUNDA evidência
 *    persistente (linha em `legal_consents` com `source='signup'`),
 *    `profiles.role='user'`, fora de `internal_test_accounts`, mais antigo
 *    que o corte;
 * 2. revalidação imediata de CADA usuário antes de excluir (contra corrida
 *    com uma confirmação de e-mail entre a listagem e a exclusão), relendo o
 *    marcador em `app_metadata`.
 * Pendente, marcador, role=user e idade > 7 dias, SOZINHOS, nunca bastam: a
 * origem pública precisa ser comprovável pelas duas evidências.
 * Contas de análise, administrativas, confirmadas ou criadas por outros meios
 * nunca chegam à exclusão. Idempotente: rodar de novo não tem efeito além do
 * que já foi limpo; falha em um usuário não interrompe os demais.
 *
 * A execução AGENDADA não faz parte desta etapa (nenhum cron foi criado): a
 * rota app/api/internal/signup-cleanup/route.ts expõe o mecanismo, protegido
 * por `CRON_SECRET`, para ser acionado por um agendador quando decidido.
 */
import { captureAuthError } from '@/lib/monitoring/capture-auth-error'

export const PENDING_SIGNUP_RETENTION_DAYS = 7
export const CLEANUP_BATCH_SIZE = 100

export interface CleanupUserInfo {
  id: string
  confirmed: boolean
  hasSignedIn: boolean
  createdByPublicFlow: boolean
}

export interface PendingSignupCleanupPorts {
  /** Ids candidatos criados antes de `cutoffIso` (a função do banco aplica todas as condições). */
  listStale(cutoffIso: string, limit: number): Promise<string[]>
  /** Estado atual do usuário; `null` se já não existe. */
  getUser(userId: string): Promise<CleanupUserInfo | null>
  deleteUser(userId: string): Promise<void>
  now?: () => number
}

export interface CleanupResult {
  cutoff: string
  candidates: number
  deleted: number
  skipped: number
  failed: number
}

export async function cleanupPendingSignups(ports: PendingSignupCleanupPorts, retentionDays: number = PENDING_SIGNUP_RETENTION_DAYS): Promise<CleanupResult> {
  const now = (ports.now ?? Date.now)()
  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const candidates = await ports.listStale(cutoff, CLEANUP_BATCH_SIZE)

  const result: CleanupResult = { cutoff, candidates: candidates.length, deleted: 0, skipped: 0, failed: 0 }

  for (const userId of candidates) {
    try {
      const user = await ports.getUser(userId)
      // Segunda barreira: só exclui se AINDA for um pendente do fluxo público.
      if (!user || user.confirmed || user.hasSignedIn || !user.createdByPublicFlow) {
        result.skipped += 1
        continue
      }
      await ports.deleteUser(userId)
      result.deleted += 1
    } catch (error) {
      result.failed += 1
      captureAuthError('signup_cleanup', error)
    }
  }

  return result
}
