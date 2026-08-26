/**
 * app/global-error.tsx
 * Etapa "Sentry + tratamento global de erros" — boundary de última
 * instância: só dispara quando o próprio layout raiz (app/layout.tsx)
 * quebra, e por isso PRECISA renderizar <html>/<body> própria (substitui
 * a árvore inteira). Deliberadamente sem depender de nenhum componente do
 * design system (Card/Button) nem de classes Tailwind — usa estilo
 * inline com os mesmos valores de app/globals.css, para funcionar mesmo
 * se o motivo da quebra tiver relação com o próprio layout/CSS.
 */
'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: '#0b0d10', color: '#f5f7fa', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Algo deu errado</h1>
          <p style={{ maxWidth: '24rem', fontSize: '0.875rem', color: '#8b949e', margin: 0 }}>
            Ocorreu um erro inesperado ao carregar o Numora. Você pode tentar novamente — se o problema continuar,
            fale com a gente em{' '}
            <a href="mailto:suporte.numora@gmail.com" style={{ color: '#d4a84f' }}>
              suporte.numora@gmail.com
            </a>
            .
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: '2.5rem',
              padding: '0 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#d4a84f',
              color: '#0b0d10',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  )
}
