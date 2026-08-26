/**
 * sentry.edge.config.ts
 * Etapa "Sentry + tratamento global de erros" — inicialização do SDK para
 * o Edge Runtime (ex.: se algum Route Handler futuro rodar em Edge).
 * Importado por instrumentation.ts, nunca diretamente. Mesma
 * configuração mínima de sentry.server.config.ts — ver comentário lá
 * sobre a ausência deliberada de tracing/replay.
 */
import * as Sentry from '@sentry/nextjs'

import { scrubErrorEvent } from '@/lib/monitoring/sentry-before-send'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  sendDefaultPii: false,
  beforeSend: scrubErrorEvent,
})
