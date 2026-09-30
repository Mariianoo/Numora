/**
 * app/api/internal/signup-cleanup/route.ts
 * Etapa "B2.4 — Signup server-controlled" — aciona a limpeza de cadastros
 * públicos pendentes com mais de 7 dias (lib/auth/pending-signup-cleanup.ts).
 *
 * NENHUM agendador foi criado nesta etapa (sem vercel.json/cron): este
 * endpoint é o mecanismo, para ser chamado por um cron quando decidido. É
 * protegido por `Authorization: Bearer <CRON_SECRET>` (formato do Vercel Cron)
 * e FALHA FECHADO: sem `CRON_SECRET` configurado a rota responde 404, como se
 * não existisse. A comparação é em tempo constante; o segredo nunca é
 * registrado nem devolvido.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { cleanupPendingSignups } from '@/lib/auth/pending-signup-cleanup'
import { readOwnership } from '@/lib/auth/signup-adapters'
import { captureAuthError } from '@/lib/monitoring/capture-auth-error'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(header)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return new NextResponse('Not found', { status: 404 })
  if (!isAuthorized(request, secret)) return new NextResponse('Unauthorized', { status: 401 })

  const requestId = randomUUID()
  try {
    const admin = getSupabaseAdminClient()
    const result = await cleanupPendingSignups({
      async listStale(cutoffIso, limit) {
        const { data, error } = await admin.rpc('list_stale_pending_public_signups', { p_cutoff: cutoffIso, p_limit: limit })
        if (error) throw new Error('Falha ao listar cadastros pendentes.')
        return ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)
      },
      async getUser(userId) {
        const { data, error } = await admin.auth.admin.getUserById(userId)
        if (error) {
          if (error.status === 404) return null
          throw new Error('Falha ao consultar o usuário.')
        }
        const user = data.user
        if (!user) return null
        return {
          id: user.id,
          confirmed: Boolean(user.email_confirmed_at),
          hasSignedIn: Boolean(user.last_sign_in_at),
          // Origem pública comprovada só por app_metadata (server-only) + nonce — nunca por user_metadata.
          createdByPublicFlow: readOwnership(user.app_metadata).ownedByPublicFlow,
        }
      },
      async deleteUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId)
        if (error) throw new Error('Falha ao remover o cadastro pendente.')
      },
    })

    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    captureAuthError('signup_cleanup', error, { requestId })
    return NextResponse.json({ ok: false }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
