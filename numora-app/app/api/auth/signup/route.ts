/**
 * app/api/auth/signup/route.ts
 * Etapa "B2.4 — Signup server-controlled" — ÚNICO caminho de criação de conta
 * pública. FECHADO por padrão: só responde além de 403 quando
 * `SIGNUP_ENABLED === "true"` (fail-closed, lib/auth/signup-flag.ts). Em
 * Production a flag não existe, então nenhuma conta é criada por aqui.
 *
 * O GoTrue público permanece com `disable_signup=true` (configuração externa
 * do Supabase): o navegador nunca chama `supabase.auth.signUp()`. Toda a
 * lógica está em lib/auth/signup-handler.ts; aqui só se ligam as portas
 * reais (Admin API, Turnstile, Resend), todas server-only.
 */
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

import { createSignupAdminPort, createSignupRateLimiterPort } from '@/lib/auth/signup-adapters'
import { handleSignupRequest } from '@/lib/auth/signup-handler'
import { verifyTurnstileToken } from '@/lib/captcha/turnstile-server'
import { sendEmail } from '@/lib/email/resend'
import { recordSignupConsents } from '@/lib/legal/signup-consents'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const result = await handleSignupRequest(request, {
    env: process.env,
    requestId: randomUUID(),
    admin: createSignupAdminPort(getSupabaseAdminClient),
    rateLimiter: createSignupRateLimiterPort(getSupabaseAdminClient),
    verifyCaptcha: (token, secret) => verifyTurnstileToken({ token, secret }),
    recordConsents: (userId, consents) => recordSignupConsents(getSupabaseAdminClient(), userId, consents),
    sendEmail: (email, config) => sendEmail(email, { apiKey: config.apiKey, from: config.from }),
  })

  return NextResponse.json(result.body, { status: result.status, headers: { ...result.headers, 'Cache-Control': 'no-store' } })
}
