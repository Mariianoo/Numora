/**
 * app/api/auth/confirm/route.ts
 * Etapa "B2.4 — Signup server-controlled" — consome o token do e-mail de
 * cadastro por POST explícito (o botão de /auth/confirm). Lógica em
 * lib/auth/confirm-signup.ts. Sucesso: sessão nos cookies + redirect 303 fixo
 * para /auth/set-password. Falha: redirect 303 fixo com mensagem neutra.
 *
 * Nunca funciona por GET (scanners de e-mail): só POST existe nesta rota.
 */
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { handleConfirmRequest } from '@/lib/auth/confirm-signup'
import { ATTRIBUTION_COOKIE, persistAttributionFromCookie } from '@/lib/auth/persist-attribution'
import { getSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const cookieStore = await cookies()
  let attributionPersisted = false

  const result = await handleConfirmRequest(request, {
    env: process.env,
    requestId: randomUUID(),
    async verifyOtp(tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' })
      if (error || !data.user || !data.session) {
        // 4xx = token inválido/expirado/reutilizado; 5xx/rede = indisponível (não consome o token).
        const status = (error as { status?: number } | null)?.status
        return { ok: false, kind: typeof status === 'number' && status >= 500 ? 'unavailable' : 'invalid' }
      }
      return { ok: true, userId: data.user.id }
    },
    async afterConfirm(userId) {
      const attributionCookie = cookieStore.get(ATTRIBUTION_COOKIE)?.value
      if (attributionCookie) {
        attributionPersisted = await persistAttributionFromCookie(supabase, userId, attributionCookie)
      }
    },
  })

  if (result.kind === 'error') {
    return new NextResponse(result.message, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
  }

  const response = NextResponse.redirect(result.location, result.status)
  response.headers.set('Cache-Control', 'no-store')
  if (attributionPersisted) {
    response.cookies.delete(ATTRIBUTION_COOKIE)
  }
  return response
}
