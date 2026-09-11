/**
 * tests/unit/proxy-maintenance-mode.test.ts
 * Etapa "5.10L-A — Maintenance Mode Core" — cobre o kill-switch de
 * manutenção em `proxy.ts` inteiramente in-process (`NextRequest`/
 * `NextResponse` reais do `next/server`, nenhuma rede, nenhum Supabase,
 * nenhum Stripe). Variáveis de ambiente são manipuladas via
 * `vi.stubEnv`/`vi.unstubAllEnvs` (nunca vazam para outros arquivos de
 * teste, que rodam em processos/contextos isolados pelo Vitest).
 *
 * NÃO cobre a renderização de `app/maintenance/page.tsx` (Server Component
 * React — este repositório não tem infraestrutura de render de RSC em
 * `tests/unit`, environment é `node`, não `jsdom`). Essa página foi
 * validada por: (1) compilar com sucesso em `npm run build` sem nenhuma
 * variável de ambiente de Supabase/Stripe necessária, e (2) inspeção do
 * código-fonte confirmando zero import de `@supabase/*`/`stripe` — ver
 * relatório da etapa, seção H/M.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { proxy } from '@/proxy'

const BYPASS_TOKEN = 'test-only-bypass-token-38xk291'

function makeRequest(path: string, options: { cookie?: string } = {}): NextRequest {
  const headers = options.cookie ? { cookie: options.cookie } : undefined
  return new NextRequest(new URL(path, 'https://numoracollect.com'), { headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('proxy — Maintenance Mode (Etapa 5.10L-A)', () => {
  it('A) Production + manutenção OFF: /dashboard sem cookie continua redirecionando para /login (comportamento preexistente preservado)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'false')

    const response = proxy(makeRequest('/dashboard'))

    expect(response.headers.get('location')).toBe('https://numoracollect.com/login')
  })

  it('B) Production + manutenção ON: rota pública (/) é redirecionada para /maintenance', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/'))

    expect(response.headers.get('location')).toBe('https://numoracollect.com/maintenance')
  })

  it('C) Production + manutenção ON: /dashboard é redirecionado para /maintenance (nunca para /login — manutenção tem prioridade)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/dashboard/profile'))

    expect(response.headers.get('location')).toBe('https://numoracollect.com/maintenance')
  })

  it('D) Production + manutenção ON: /admin é bloqueado sem bypass', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/admin'))

    expect(response.headers.get('location')).toBe('https://numoracollect.com/maintenance')
  })

  it('E) Production + manutenção ON: /maintenance é acessível (sem loop de redirect)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/maintenance'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('F) Production + manutenção ON: /status é acessível (liberado mesmo antes de existir, Etapa 5.10L-B/C)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/status'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('G) Production + manutenção ON: /api/stripe/webhook nunca é bloqueado', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/api/stripe/webhook'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('H) Production + manutenção ON: assets sob /_next/ continuam acessíveis (defesa em profundidade, além do matcher)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/_next/static/chunks/main.js'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('rotas de billing/account-delete são bloqueadas durante manutenção (nunca na allowlist)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    for (const path of [
      '/api/account/delete',
      '/api/billing/checkout',
      '/api/billing/customer',
      '/api/billing/portal',
      '/api/billing/subscription/cancel',
      '/api/billing/subscription/change-plan',
    ]) {
      const response = proxy(makeRequest(path))
      expect(response.headers.get('location')).toBe('https://numoracollect.com/maintenance')
    }
  })

  it('I) Production + manutenção ON: bypass com token correto troca a URL (remove o token) e grava cookie HttpOnly', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', BYPASS_TOKEN)

    const response = proxy(makeRequest(`/dashboard?maintenance_bypass=${BYPASS_TOKEN}`))

    // N) o token nunca deve sobreviver na URL de destino do redirect.
    expect(response.headers.get('location')).toBe('https://numoracollect.com/dashboard')

    const cookie = response.cookies.get('numora_maintenance_bypass')
    expect(cookie?.value).toBe(BYPASS_TOKEN)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.path).toBe('/')
  })

  it('I-cont.) requisição subsequente com o cookie de bypass já concedido passa direto (tratada como manutenção desligada)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', BYPASS_TOKEN)

    const response = proxy(makeRequest('/', { cookie: `numora_maintenance_bypass=${BYPASS_TOKEN}` }))

    expect(response.headers.get('location')).toBeNull()
  })

  it('J) Production + manutenção ON: bypass com token incorreto continua bloqueado', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', BYPASS_TOKEN)

    const viaQuery = proxy(makeRequest('/dashboard?maintenance_bypass=token-errado'))
    expect(viaQuery.headers.get('location')).toBe('https://numoracollect.com/maintenance')

    const viaCookie = proxy(makeRequest('/', { cookie: 'numora_maintenance_bypass=token-errado' }))
    expect(viaCookie.headers.get('location')).toBe('https://numoracollect.com/maintenance')
  })

  it('bypass de manutenção não concede autenticação: /admin sem cookie de sessão ainda vai para /login', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', BYPASS_TOKEN)

    const response = proxy(makeRequest('/admin', { cookie: `numora_maintenance_bypass=${BYPASS_TOKEN}` }))

    expect(response.headers.get('location')).toBe('https://numoracollect.com/login')
  })

  it('K) Preview + manutenção ON: nunca bloqueia, independente do valor de MAINTENANCE_MODE', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('L) Development (VERCEL_ENV="development") + manutenção ON: nunca bloqueia', () => {
    vi.stubEnv('VERCEL_ENV', 'development')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('sem MAINTENANCE_BYPASS_TOKEN configurado: nenhum token de query concede bypass (nunca aceita comparação contra undefined)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('MAINTENANCE_MODE', 'true')

    const response = proxy(makeRequest('/dashboard?maintenance_bypass='))

    expect(response.headers.get('location')).toBe('https://numoracollect.com/maintenance')
  })
})
