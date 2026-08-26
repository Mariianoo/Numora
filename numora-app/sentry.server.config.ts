/**
 * sentry.server.config.ts
 * Etapa "Sentry + tratamento global de erros" — inicialização do SDK para
 * o runtime Node.js (Route Handlers, Server Components, Server Actions).
 * Importado por instrumentation.ts (nunca importado diretamente por
 * código de aplicação) — convenção oficial do @sentry/nextjs para
 * Turbopack (Next.js 16), que não faz mais o auto-import que o build
 * Webpack fazia.
 *
 * Sem `tracesSampleRate`/integrations de performance/replay de propósito
 * — esta etapa pede só captura de erro, nunca monitoramento de
 * performance nem replay de sessão (replay grava DOM/input do usuário,
 * o oposto do que "sem dados pessoais no Sentry" pede).
 */
import * as Sentry from '@sentry/nextjs'

import { scrubErrorEvent } from '@/lib/monitoring/sentry-before-send'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  sendDefaultPii: false,
  beforeSend: scrubErrorEvent,
})
