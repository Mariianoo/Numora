/**
 * app/api/health/ready/route.ts
 * Etapa "5.10L-B — Health Check" — readiness: "o Numora está operacional
 * o suficiente para receber tráfego?". Verifica banco (`checkDatabase`),
 * Storage (`checkStorage`) e configuração essencial (`checkConfiguration`)
 * — ver `lib/health/ready-checks.ts` para a lógica de cada um (decisões
 * arquiteturais confirmadas explicitamente na etapa).
 *
 * Público, sem sessão, sem `service_role`. A resposta nunca inclui
 * mensagem de exceção, código Postgres, nome de tabela/bucket ou qualquer
 * detalhe interno — só os rótulos genéricos `'ok'`/`'fail'` por
 * componente. Uma falha esperada de dependência (banco/Storage fora do
 * ar) é um resultado operacional normal (`503`), nunca uma exceção não
 * tratada — por isso o corpo inteiro roda dentro de um `try/catch` que
 * nunca deixa vazar um erro bruto para a resposta.
 *
 * Já liberado pelo Maintenance Mode (`proxy.ts`, Etapa 5.10L-A) via
 * `/api/health/*` — nenhuma alteração necessária ali.
 */
import { NextResponse } from 'next/server'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { checkConfiguration, checkDatabase, checkStorage, type CheckResult } from '@/lib/health/ready-checks'

export const dynamic = 'force-dynamic'

function jsonResponse(status: 'ready' | 'not_ready', checks: Record<string, CheckResult>) {
  return NextResponse.json({ status, checks }, { status: status === 'ready' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET() {
  try {
    const configuration = checkConfiguration()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

    const supabase = await getSupabaseServerClient()
    const [database, storage] = await Promise.all([checkDatabase(supabase), checkStorage(supabaseUrl)])

    const checks = { database, storage, configuration }
    const isReady = database === 'ok' && storage === 'ok' && configuration === 'ok'

    return jsonResponse(isReady ? 'ready' : 'not_ready', checks)
  } catch {
    // Defesa em profundidade: mesmo uma falha inesperada ao montar o
    // client de sessão (nunca observada em teste, mas nunca vale a pena
    // deixar vazar) vira "not_ready" genérico, nunca uma exceção crua.
    return jsonResponse('not_ready', { database: 'fail', storage: 'fail', configuration: 'fail' })
  }
}
