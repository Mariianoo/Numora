/**
 * instrumentation.ts
 * Etapa "Sentry + tratamento global de erros" — hook oficial do Next.js
 * (App Router) para inicialização server-side. `register()` roda uma
 * única vez, cedo, e é o único lugar que decide qual config carregar por
 * runtime (Node vs Edge) — nenhum outro arquivo deve importar
 * sentry.server.config.ts/sentry.edge.config.ts diretamente.
 *
 * `onRequestError` (exigido pelo Next.js 15+/@sentry/nextjs >= 8.28,
 * versão instalada é 10.x): captura automaticamente exceções não
 * tratadas que estourem dentro de Route Handlers/Server Components,
 * sem precisar de try/catch manual em cada um.
 */
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
