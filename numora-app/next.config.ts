import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
}

// Sem `org`/`project`/`authToken`: build de source map/upload de release
// fica desativado (a captura de erro em si não depende disso) — evita
// exigir um secret de build (SENTRY_AUTH_TOKEN) nesta primeira fase.
export default withSentryConfig(nextConfig, {
  silent: true,
})
