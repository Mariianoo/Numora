import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

/**
 * Etapa "F4 — Security Headers" (Beta Readiness Audit). Origens reais
 * levantadas por auditoria read-only do código antes de escrever isto —
 * nunca uma lista genérica:
 * - Supabase (API/Auth/Storage): `https://<ref>.supabase.co`, ref
 *   diferente por ambiente — `*.supabase.co` cobre DEV/Production sem
 *   header condicional por ambiente (mesmo padrão recomendado pela própria
 *   Supabase para apps com múltiplos projetos).
 * - Sentry: DSN aponta para `https://o<org>.ingest.us.sentry.io` (region
 *   US) — `*.ingest.us.sentry.io` cobre rotação de org/projeto sem
 *   precisar reeditar isto a cada troca de DSN.
 * - Google Tag Manager: `https://www.googletagmanager.com` — só quando
 *   `NEXT_PUBLIC_GTM_ID` está setado E o usuário consentiu com analytics
 *   (`components/analytics/GoogleTagManager.tsx`); mesmo quando inativo,
 *   liberar o domínio não expõe nada (é o loader oficial do próprio
 *   Google). O conteúdo do container GTM (quais tags/pixels rodam dentro
 *   dele) é opaco a partir do código — se uma tag futura (ex.: GA4,
 *   Google Ads) precisar de outro domínio em `connect-src`, esta lista
 *   precisará ser atualizada então; não é possível prever isso hoje.
 * - Fontes (`next/font/google`, Inter): auto-hospedadas no build pelo
 *   próprio Next.js — nenhum request a fonts.googleapis.com/gstatic.com
 *   em runtime, confirmado (nenhum `<link>` para esses domínios no app).
 * - QR Code do Passport (`qrcode`, `toDataURL`): gera `data:image/png;...`
 *   — por isso `img-src` inclui `data:`.
 * - Nenhum `<iframe>` existe no app, e nada foi desenhado para ser
 *   embedado em iframe de terceiros — `frame-src`/`frame-ancestors` podem
 *   ser `'none'` com segurança.
 * - Nenhum uso de Realtime/WebSocket do Supabase (`.channel(...)`) em
 *   nenhum lugar do código — `connect-src` não precisa de `wss:`.
 * - OAuth (Google, sem uso na UI hoje): `signInWithOAuth` faz um
 *   redirect de página inteira (`window.location`), nunca um
 *   fetch/popup — não é restringido por `connect-src`/`form-action`,
 *   então nenhuma CSP aqui bloqueia reativar esse fluxo no futuro.
 *
 * `'unsafe-inline'` em `script-src`/`style-src`: necessário sem nonces
 * (fora do escopo desta etapa, por pedido explícito) — o próprio Next.js
 * injeta scripts inline para hidratação/streaming do App Router, e o
 * loader do GTM (`GoogleTagManager.tsx`) é um `<script>` inline. Hardening
 * com nonce fica como melhoria futura, não desta etapa.
 *
 * CSP só em produção: em `next dev`, o Fast Refresh do Turbopack depende de
 * `eval` no próprio runtime de HMR — aplicar a CSP também em dev geraria
 * erros de console que nunca existiriam em Production (o ambiente que este
 * header de fato protege). Os demais headers (sem relação com HMR/eval)
 * valem em qualquer ambiente.
 */
const isProduction = process.env.NODE_ENV === 'production'

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.ingest.us.sentry.io https://www.googletagmanager.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: isProduction
          ? [...SECURITY_HEADERS, { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }]
          : SECURITY_HEADERS,
      },
    ]
  },
}

// Sem `org`/`project`/`authToken`: build de source map/upload de release
// fica desativado (a captura de erro em si não depende disso) — evita
// exigir um secret de build (SENTRY_AUTH_TOKEN) nesta primeira fase.
export default withSentryConfig(nextConfig, {
  silent: true,
})
