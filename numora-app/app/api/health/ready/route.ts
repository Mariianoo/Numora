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
 *
 * Etapa "5.10L-C — Status Page": a orquestração dos 3 checks (antes
 * inline aqui) foi extraída para `getReadinessSnapshot()`
 * (`lib/health/ready-checks.ts`) — `/status` reaproveita exatamente a
 * mesma função, nunca uma segunda implementação da lógica de "o que
 * significa pronto".
 */
import { NextResponse } from 'next/server'

import { getReadinessSnapshot, isReadySnapshot } from '@/lib/health/ready-checks'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks = await getReadinessSnapshot()
  const isReady = isReadySnapshot(checks)

  return NextResponse.json(
    { status: isReady ? 'ready' : 'not_ready', checks },
    { status: isReady ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
