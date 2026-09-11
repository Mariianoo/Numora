/**
 * app/maintenance/page.tsx
 * Etapa "5.10L-A — Maintenance Mode Core" — página exibida por `proxy.ts`
 * quando `MAINTENANCE_MODE=true` em Production. Server Component puro:
 * NENHUMA chamada a Supabase/Stripe/qualquer serviço externo — precisa
 * continuar renderizando mesmo com banco/Storage inteiramente fora do ar
 * (é frequentemente exibida justamente POR CAUSA de uma manutenção de
 * banco). Só lê variáveis de ambiente já públicas por natureza (aparecem
 * nesta própria página) — nunca `MAINTENANCE_BYPASS_TOKEN`, que só existe
 * em `proxy.ts`.
 *
 * `dynamic = 'force-dynamic'` evita que o Next.js pré-renderize esta
 * página estaticamente em build time e sirva uma versão desatualizada da
 * mensagem/motivo/ETA depois — força `Cache-Control: private, no-cache,
 * no-store, max-age=0, must-revalidate` (comportamento padrão do Next.js
 * para páginas dinâmicas), consistente com a etapa nunca querer que esta
 * página fique presa em cache de CDN/navegador.
 *
 * Reaproveita `AuthShell`/`Card` (mesmos componentes de login/cadastro/
 * app/error.tsx) — nenhum componente novo de layout, mesma identidade
 * visual do resto do produto.
 */
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Wrench } from 'lucide-react'

import { AuthShell } from '@/components/ui/AuthShell'
import { Card } from '@/components/ui/Card'

const DEFAULT_MESSAGE = 'Estamos realizando uma atualização programada para melhorar sua experiência.'

export default function MaintenancePage() {
  const message = process.env.MAINTENANCE_MESSAGE || DEFAULT_MESSAGE
  const reason = process.env.MAINTENANCE_REASON
  const eta = process.env.MAINTENANCE_ETA

  return (
    <AuthShell tagline={message}>
      <Card className="w-full max-w-sm p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Wrench className="size-7" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-text-primary">Numora em manutenção</h1>
            {reason && <p className="text-sm text-text-secondary">Motivo: {reason}</p>}
            {eta && <p className="text-sm text-text-secondary">Previsão de retorno: {eta}</p>}
          </div>
          <Link href="/status" className="text-sm text-accent underline underline-offset-2 hover:text-accent-hover">
            Ver status do sistema
          </Link>
          <p className="text-xs text-text-secondary">
            Dúvidas?{' '}
            <a
              href="mailto:suporte.numora@gmail.com"
              className="underline underline-offset-2 hover:text-accent-hover"
            >
              suporte.numora@gmail.com
            </a>
          </p>
        </div>
      </Card>
    </AuthShell>
  )
}
