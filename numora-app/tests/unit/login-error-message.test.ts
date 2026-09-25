/**
 * tests/unit/login-error-message.test.ts
 * Etapa "B1 — Official Launch, código de cobrança" — `?error=auth_callback_failed`
 * em /login. A regra (whitelist estrita) é testada com comportamento real; a
 * página em si (sem jsdom neste repositório — ver a nota de limitação em
 * tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts) é coberta
 * por inspeção do código-fonte, sobre o código (comentários removidos).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { getLoginQueryErrorMessage } from '@/features/auth/login-error-message'

const ROOT = path.resolve(__dirname, '../..')

function readCode(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('getLoginQueryErrorMessage', () => {
  it('auth_callback_failed → mensagem clara em português', () => {
    const message = getLoginQueryErrorMessage('auth_callback_failed')
    expect(message).toBe('Não foi possível concluir a confirmação do seu acesso. Tente entrar novamente ou solicite um novo link.')
  })

  it.each([null, undefined, '', 'unknown_error', 'AUTH_CALLBACK_FAILED', ' auth_callback_failed', 'auth_callback_failed ', 'invalid_credentials'])(
    'parâmetro ausente ou desconhecido (%j) → null: o login se comporta exatamente como antes',
    (code) => {
      expect(getLoginQueryErrorMessage(code)).toBeNull()
    },
  )

  it('nunca reflete o valor da URL na mensagem (sem injeção de texto)', () => {
    for (const code of ['<script>alert(1)</script>', 'toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      expect(getLoginQueryErrorMessage(code)).toBeNull()
    }
  })

  it('a mensagem não expõe stack trace nem detalhe interno', () => {
    const message = getLoginQueryErrorMessage('auth_callback_failed') ?? ''
    expect(message).not.toMatch(/exchangeCodeForSession|supabase|stack|error:|exception|500|callback/i)
  })
})

describe('app/login/page.tsx — exibição do erro do callback', () => {
  const code = readCode('app/login/page.tsx')

  it('lê o parâmetro `error` da URL via useSearchParams, dentro de um limite de Suspense (a página é estática)', () => {
    expect(code).toMatch(/useSearchParams\(\)/)
    expect(code).toMatch(/searchParams\.get\('error'\)/)
    expect(code).toMatch(/<Suspense/)
    expect(code).toMatch(/export default function LoginPage\(\)/)
  })

  it('a mensagem sai da whitelist (getLoginQueryErrorMessage), nunca do valor cru da URL', () => {
    expect(code).toMatch(/getLoginQueryErrorMessage\(searchParams\.get\('error'\)\)/)
    expect(code).not.toMatch(/\{searchParams\.get\(/)
  })

  it('o aviso é exibido enquanto não houver tentativa de login e some quando o usuário tenta entrar de novo (erros de login continuam prevalecendo)', () => {
    expect(code).toMatch(/error \?\? \(hasAttemptedLogin \? null : queryErrorMessage\)/)
    expect(code).toMatch(/setHasAttemptedLogin\(true\)/)
  })

  it('o fluxo normal de login não foi alterado (mesmo signInWithPassword, mesmos redirects, mesmo formulário)', () => {
    expect(code).toMatch(/authRepository\.signInWithPassword\(email, password\)/)
    expect(code).toMatch(/router\.replace\('\/dashboard'\)/)
    expect(code).toMatch(/router\.refresh\(\)/)
    expect(code).toMatch(/Esqueci minha senha/)
  })

  it('outros códigos de erro não foram alterados: o callback continua redirecionando com o mesmo parâmetro', () => {
    const callback = readCode('app/auth/callback/route.ts')
    expect(callback).toMatch(/\/login\?error=auth_callback_failed/)
  })
})
