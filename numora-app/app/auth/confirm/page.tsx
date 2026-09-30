/**
 * app/auth/confirm/page.tsx
 * Etapa "B2.4 — Signup server-controlled" — destino do link do e-mail de
 * cadastro. Esta página NÃO consome o token: só exibe um botão que faz POST
 * para /api/auth/confirm. Assim, scanners/prefetch de e-mail que fazem GET
 * nunca gastam o token de uso único.
 *
 * O `token_hash` só é lido para ser repassado no formulário (campo oculto);
 * nunca é exibido, registrado nem usado em outro lugar. Parâmetro ausente ou
 * malformado → mensagem neutra. `dynamic` porque depende da query string.
 */
import Link from 'next/link'
import { MailCheck, TriangleAlert } from 'lucide-react'

import { AuthShell } from '@/components/ui/AuthShell'
import { Card } from '@/components/ui/Card'
import { CONFIRM_TOKEN_TYPE, TOKEN_HASH_PATTERN } from '@/lib/email/signup-email'

export const metadata = {
  title: 'Confirmar e-mail — Numora',
}

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const buttonClass =
  'flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-background shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <AuthShell tagline="Confirmação de e-mail">
      <Card className="w-full max-w-sm p-7">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="size-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
            <p className="mt-2 text-sm text-text-secondary">{description}</p>
          </div>
          <Link href="/login" className={buttonClass}>
            Ir para o login
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}

export default async function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const error = first(params.error)
  const tokenHash = first(params.token_hash)
  const type = first(params.type)

  if (error === 'unavailable') {
    return <Notice title="Não foi possível confirmar agora" description="Tente novamente em alguns instantes, usando o mesmo link do e-mail." />
  }

  if (error || type !== CONFIRM_TOKEN_TYPE || !tokenHash || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    return (
      <Notice
        title="Link inválido ou expirado"
        description="Este link não pode mais ser usado. Se você ainda não confirmou seu e-mail, faça o cadastro novamente para receber um novo link."
      />
    )
  }

  return (
    <AuthShell tagline="Confirmação de e-mail">
      <Card className="w-full max-w-sm p-7">
        <form method="POST" action="/api/auth/confirm" className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <MailCheck className="size-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Confirme seu e-mail</h1>
            <p className="mt-2 text-sm text-text-secondary">Clique no botão abaixo para confirmar o e-mail e definir sua senha.</p>
          </div>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={CONFIRM_TOKEN_TYPE} />
          <button type="submit" className={buttonClass}>
            Confirmar meu e-mail
          </button>
        </form>
      </Card>
    </AuthShell>
  )
}
