/**
 * instrumentation-client.ts
 * Etapa "Sentry + tratamento global de erros" — inicialização do SDK no
 * navegador. Convenção do @sentry/nextjs para Turbopack (Next.js 16):
 * sob Turbopack o build NÃO faz mais o auto-import de
 * `sentry.client.config.ts` que o Webpack fazia — este arquivo, com este
 * nome exato, é o novo ponto de entrada reconhecido pelo Next.js.
 *
 * Sem `tracesSampleRate`/replay/feedback de propósito — ver comentário em
 * sentry.server.config.ts.
 */
import * as Sentry from '@sentry/nextjs'

import { scrubErrorEvent } from '@/lib/monitoring/sentry-before-send'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV ?? 'development',
  sendDefaultPii: false,
  beforeSend: scrubErrorEvent,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
