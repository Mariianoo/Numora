/**
 * tests/unit/auth-callback-b2.test.ts — Etapa "B2 — Signup + Legal".
 * Callback de auth: país persistido/completado, metadata inválida tratada,
 * confirmação em outro navegador não perde dado crítico, sem open redirect.
 * Mais: captura segura de erros de auth no Sentry.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

import { resolveCallbackProfileFields } from '@/lib/auth/callback-profile'
import { captureAuthError, sanitizeErrorMessage } from '@/lib/monitoring/capture-auth-error'

const ROOT = path.resolve(__dirname, '../..')

function readCode(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

beforeEach(() => captureException.mockReset())

describe('resolveCallbackProfileFields', () => {
  it('BR válido na metadata → país a preencher; nome e e-mail sincronizados', () => {
    expect(resolveCallbackProfileFields({ email: 'a@example.com', user_metadata: { name: ' Ana ', country_code: 'BR' } })).toEqual({
      base: { email: 'a@example.com', name: 'Ana' },
      countryToFill: 'BR',
    })
  })

  it.each(['br', 'BRA', 'XX1', '', ' BR', 55, null, undefined, { code: 'BR' }, ['BR']])('país inválido (%j) → nada a preencher, mas nome/e-mail continuam', (value) => {
    const result = resolveCallbackProfileFields({ email: 'a@example.com', user_metadata: { name: 'Ana', country_code: value } })
    expect(result.countryToFill).toBeNull()
    expect(result.base).toEqual({ email: 'a@example.com', name: 'Ana' })
  })

  it('metadata sem nome NÃO apaga o nome existente (chave ausente do UPDATE)', () => {
    const result = resolveCallbackProfileFields({ email: 'a@example.com', user_metadata: {} })
    expect(result.base).toEqual({ email: 'a@example.com' })
    expect(result.base).not.toHaveProperty('name')
  })

  it.each([undefined, null, 'texto', 42, []])('user_metadata inesperado (%j) não lança e não produz país', (metadata) => {
    expect(() => resolveCallbackProfileFields({ email: null, user_metadata: metadata })).not.toThrow()
    expect(resolveCallbackProfileFields({ email: null, user_metadata: metadata })).toEqual({ base: {}, countryToFill: null })
  })

  it('nome vazio, só espaços ou longo demais é ignorado; full_name é aceito como fallback', () => {
    expect(resolveCallbackProfileFields({ user_metadata: { name: '   ' } }).base).toEqual({})
    expect(resolveCallbackProfileFields({ user_metadata: { name: 'a'.repeat(101) } }).base).toEqual({})
    expect(resolveCallbackProfileFields({ user_metadata: { full_name: 'Maria' } }).base).toEqual({ name: 'Maria' })
  })
})

describe('app/auth/callback/route.ts — B2', () => {
  const code = readCode('app/auth/callback/route.ts')

  it('o país é um UPDATE separado e só preenche quando ainda está vazio (nunca sobrescreve)', () => {
    expect(code).toMatch(/\.update\(\{ country_code: countryToFill \}\)/)
    expect(code).toMatch(/\.is\('country_code', null\)/)
  })

  it('erros de UPDATE de profile deixam de ser ignorados (vão ao Sentry sanitizado) e nunca bloqueiam o login', () => {
    expect(code).toMatch(/captureAuthError\('auth_callback_profile', profileError\)/)
    expect(code).toMatch(/captureAuthError\('auth_callback_profile', countryError\)/)
    expect(code).toMatch(/NextResponse\.redirect\(`\$\{origin\}\/dashboard`\)/)
  })

  it('confirmação em outro navegador: troca PKCE que falha continua indo a /login?error=auth_callback_failed (sem sessão, sem dado perdido — o trigger já gravou o país)', () => {
    expect(code).toMatch(/exchangeCodeForSession\(code\)/)
    expect(code).toMatch(/\/login\?error=auth_callback_failed/)
    expect(code).toMatch(/captureAuthError\('auth_callback', error\)/)
  })

  it('sem open redirect: só `code` é lido e o destino é sempre fixo (`origin` + /dashboard ou /login)', () => {
    expect(code).toMatch(/searchParams\.get\('code'\)/)
    expect(code).not.toMatch(/searchParams\.get\('(next|redirect|redirect_to|redirectTo|return|returnTo|url)'\)/)
    const redirects = code.match(/NextResponse\.redirect\([^)]*\)/g) ?? []
    expect(redirects.length).toBeGreaterThan(0)
    for (const redirect of redirects) {
      expect(redirect).toMatch(/\$\{origin\}\/(dashboard|login\?error=auth_callback_failed)/)
    }
  })

  it('não usa mais Sentry direto (só o helper que sanitiza) nem console.*', () => {
    expect(code).not.toMatch(/Sentry\./)
    expect(code).not.toMatch(/console\./)
  })
})

describe('captureAuthError — Sentry sem dados sensíveis', () => {
  it('envia um Error NOVO (nunca o objeto bruto do driver) com tags de contexto', () => {
    const original = Object.assign(new Error('falha'), { code: 'over_email_send_rate_limit', status: 429, secret: 'não-vazar' })
    captureAuthError('signup', original)

    expect(captureException).toHaveBeenCalledTimes(1)
    const [sent, options] = captureException.mock.calls[0]
    expect(sent).not.toBe(original)
    expect(sent).toBeInstanceOf(Error)
    expect(options.tags).toEqual({ auth_context: 'signup', auth_error_code: 'over_email_send_rate_limit' })
    expect(JSON.stringify(captureException.mock.calls)).not.toContain('não-vazar')
  })

  it('e-mails na mensagem são removidos', () => {
    captureAuthError('signup', new Error('User maria.silva+x@example.com already registered'))
    const sent = captureException.mock.calls[0][0] as Error
    expect(sent.message).toBe('User [email] already registered')
  })

  it('mensagem truncada e entradas estranhas não lançam', () => {
    expect(sanitizeErrorMessage('x'.repeat(500))).toHaveLength(200)
    expect(sanitizeErrorMessage(undefined)).toBe('erro desconhecido')
    expect(() => captureAuthError('auth_callback', null)).not.toThrow()
    expect(() => captureAuthError('auth_callback', 'string solta')).not.toThrow()
    expect(() => captureAuthError('signup_consent', undefined)).not.toThrow()
  })

  it('funciona sem DSN: só delega ao SDK (que é no-op sem DSN) e o Sentry mantém `dsn || undefined` nos 3 runtimes', () => {
    for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts', 'instrumentation-client.ts']) {
      expect(readCode(file)).toMatch(/dsn: process\.env\.NEXT_PUBLIC_SENTRY_DSN \|\| undefined/)
    }
    const helper = readCode('lib/monitoring/capture-auth-error.ts')
    expect(helper).not.toMatch(/dsn|DSN/)
  })

  it('o helper nunca recebe/repassa corpo, senha, cookies ou token', () => {
    const helper = readCode('lib/monitoring/capture-auth-error.ts')
    expect(helper).not.toMatch(/password|senha|captchaToken|cookie|request\.|body/i)
  })

  it('o scrubber global continua removendo chaves password/token/secret (segunda camada)', () => {
    const scrubber = readCode('lib/monitoring/sentry-before-send.ts')
    expect(scrubber).toMatch(/password\|senha\|token\|secret\|service_role\|authorization\|cookie/)
  })
})
