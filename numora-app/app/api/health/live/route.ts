/**
 * app/api/health/live/route.ts
 * Etapa "5.10L-B — Health Check" — liveness: só responde "o processo
 * Next.js está de pé?". Nenhuma chamada a Supabase/Storage/Stripe,
 * nenhuma dependência de autenticação/cookie/sessão. Público, sem
 * `service_role`, sem dado sensível — mesma superfície mínima em
 * qualquer cenário (nunca lança).
 *
 * Já liberado pelo Maintenance Mode (`proxy.ts`, Etapa 5.10L-A) via
 * `/api/health/*` — nenhuma alteração necessária ali.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
