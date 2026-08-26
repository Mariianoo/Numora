/**
 * app/error.tsx
 * Etapa "Sentry + tratamento global de erros" — error boundary do App
 * Router para qualquer segmento sob o layout raiz (não cobre erros no
 * próprio layout raiz — isso é app/global-error.tsx). Client Component,
 * convenção do Next.js: recebe `error`/`reset` como props.
 *
 * `Sentry.captureException` roda num `useEffect` (padrão oficial do
 * @sentry/nextjs para error.tsx) — nunca no corpo do componente, para não
 * capturar de novo em cada re-render.
 */
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6">
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-danger/10 blur-[110px]"
        aria-hidden
      />
      <Card className="relative z-10 w-full max-w-sm p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="size-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Algo deu errado</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Ocorreu um erro inesperado. Você pode tentar novamente — se o problema continuar, fale com a gente
              em{' '}
              <a
                href="mailto:suporte.numora@gmail.com"
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                suporte.numora@gmail.com
              </a>
              .
            </p>
          </div>
          <Button type="button" onClick={reset} className="w-full">
            Tentar novamente
          </Button>
          <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-accent">
            Voltar para o início
          </Link>
        </div>
      </Card>
    </div>
  )
}
