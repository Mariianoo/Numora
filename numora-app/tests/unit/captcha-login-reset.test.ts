/**
 * tests/unit/captcha-login-reset.test.ts — Etapa "B2.1 — Hardening".
 * CAPTCHA (Turnstile) no login e na recuperação de senha: o repositório
 * repassa `captchaToken` ao Supabase Auth só quando informado; as páginas
 * exigem o token quando o CAPTCHA está habilitado (fail-closed); o token
 * nunca é persistido, registrado nem enviado ao Sentry; nenhuma secret vai
 * ao bundle. Sem jsdom neste repositório: páginas por inspeção de código.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }))

const signInWithPassword = vi.fn()
const resetPasswordForEmail = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ auth: { signInWithPassword, resetPasswordForEmail } }),
}))

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { mapAuthErrorMessage } from '@/features/auth/map-auth-error-message'

const ROOT = path.resolve(__dirname, '../..')
const TOKEN = 'turnstile-token-SEGREDO-123'

function readCode(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

beforeEach(() => {
  signInWithPassword.mockReset()
  resetPasswordForEmail.mockReset()
  captureException.mockReset()
  vi.stubGlobal('window', { location: { origin: 'https://app.example' } })
  signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null })
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('login — repositório', () => {
  it('SEM CAPTCHA: chama o SDK exatamente como antes (só email/password, sem `options`)', async () => {
    await createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123')
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
    expect(signInWithPassword.mock.calls[0][0]).toEqual({ email: 'a@example.com', password: 'Senha@123' })
    expect(signInWithPassword.mock.calls[0][0]).not.toHaveProperty('options')
  })

  it('COM CAPTCHA: envia o token ao Supabase Auth em options.captchaToken', async () => {
    await createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123', TOKEN)
    expect(signInWithPassword.mock.calls[0][0]).toEqual({ email: 'a@example.com', password: 'Senha@123', options: { captchaToken: TOKEN } })
  })

  it('token vazio/indefinido não é enviado', async () => {
    await createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123', '')
    await createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123', undefined)
    for (const call of signInWithPassword.mock.calls) expect(call[0]).not.toHaveProperty('options')
  })

  it('fail-closed: se o Supabase EXIGE CAPTCHA e o frontend não envia token, o login falha com mensagem segura (nunca autentica)', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: 'captcha_failed', message: 'captcha protection: request disallowed (no captcha response (captcha_token) found in request)' },
    })
    await expect(createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123')).rejects.toThrow(
      'Não foi possível validar a verificação de segurança. Tente novamente.',
    )
  })

  it('a mensagem de erro nunca contém o token nem a senha', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'captcha_failed', message: `falhou ${TOKEN}`.replace(TOKEN, 'x') } })
    const error = await createSupabaseAuthRepository()
      .signInWithPassword('a@example.com', 'Senha@123', TOKEN)
      .catch((e: Error) => e)
    expect((error as Error).message).not.toContain(TOKEN)
    expect((error as Error).message).not.toContain('Senha@123')
  })

  it('credenciais inválidas continuam com a mesma mensagem (com ou sem CAPTCHA)', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials', message: 'x' } })
    await expect(createSupabaseAuthRepository().signInWithPassword('a@example.com', 'x', TOKEN)).rejects.toThrow('E-mail ou senha incorretos.')
  })
})

describe('recuperação de senha — repositório', () => {
  it('SEM CAPTCHA: chama o SDK como antes (só redirectTo)', async () => {
    await createSupabaseAuthRepository().requestPasswordReset('a@example.com')
    const [email, options] = resetPasswordForEmail.mock.calls[0]
    expect(email).toBe('a@example.com')
    expect(Object.keys(options)).toEqual(['redirectTo'])
    expect(options.redirectTo).toMatch(/\/auth\/reset-password$/)
  })

  it('COM CAPTCHA: envia o token em options.captchaToken', async () => {
    await createSupabaseAuthRepository().requestPasswordReset('a@example.com', TOKEN)
    expect(resetPasswordForEmail.mock.calls[0][1]).toMatchObject({ captchaToken: TOKEN })
  })

  it('fail-closed: CAPTCHA exigido e ausente → erro seguro, e a mensagem NÃO revela se o e-mail existe', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: { code: 'captcha_failed', message: 'x' } })
    const error = await createSupabaseAuthRepository()
      .requestPasswordReset('a@example.com')
      .catch((e: Error) => e)
    expect((error as Error).message).toBe('Não foi possível validar a verificação de segurança. Tente novamente.')
    expect((error as Error).message).not.toMatch(/a@example\.com|cadastrad|existe|encontrad/i)
  })

  it('a semântica anti-enumeração da tela não mudou: mesma mensagem de sucesso, exista ou não o e-mail', () => {
    const page = readCode('features/auth/components/ForgotPasswordForm.tsx') // Etapa B2.5.2: lógica movida para cá
    expect(page).toMatch(/Se <span className="text-text-primary">\{email\}<\/span> estiver cadastrado, enviamos um link/)
    expect(page).toMatch(/setSubmitted\(true\)/)
  })
})

describe('mapAuthErrorMessage — captcha_failed', () => {
  it('mensagem em português, sem detalhe técnico', () => {
    const message = mapAuthErrorMessage({ code: 'captcha_failed', message: 'captcha protection: request disallowed' })
    expect(message).toBe('Não foi possível validar a verificação de segurança. Tente novamente.')
    expect(message).not.toMatch(/captcha_token|disallowed|protection/i)
  })
})

describe('páginas — fail-closed e sem persistência do token', () => {
  // Etapa "B2.5.2": a lógica de login/reset (inalterada) mora agora em
  // features/auth/components/{LoginForm,ForgotPasswordForm}.tsx; app/login e
  // app/forgot-password viraram Server Components finos (ver describe abaixo).
  const login = readCode('features/auth/components/LoginForm.tsx')
  const forgot = readCode('features/auth/components/ForgotPasswordForm.tsx')

  it('login: CAPTCHA desabilitado → signInWithPassword(email, password); habilitado → com o token consumido', () => {
    expect(login).toMatch(/authRepository\.signInWithPassword\(email, password\)/)
    expect(login).toMatch(/authRepository\.signInWithPassword\(email, password, captcha\.consume\(\) \?\? undefined\)/)
  })

  it('login: habilitado e SEM token → bloqueia ANTES de chamar o Supabase', () => {
    const guard = login.indexOf('if (captcha.enabled && !captcha.token)')
    const firstCall = login.indexOf('authRepository.signInWithPassword(')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(firstCall)
    expect(login).toMatch(/setError\(CAPTCHA_REQUIRED_MESSAGE\)\s*return/)
  })

  it('reset: desabilitado → requestPasswordReset(email); habilitado → com o token; sem token bloqueia antes', () => {
    expect(forgot).toMatch(/authRepository\.requestPasswordReset\(email\)/)
    expect(forgot).toMatch(/authRepository\.requestPasswordReset\(email, captcha\.consume\(\) \?\? undefined\)/)
    expect(forgot.indexOf('if (captcha.enabled && !captcha.token)')).toBeLessThan(forgot.indexOf('authRepository.requestPasswordReset('))
    expect(forgot).toMatch(/setError\(CAPTCHA_REQUIRED_MESSAGE\)\s*return/)
  })

  it('o widget só é renderizado com a site key (nenhum script externo sem CAPTCHA configurado)', () => {
    for (const page of [login, forgot]) {
      expect(page).toMatch(/\{captcha\.siteKey && <TurnstileWidget/)
    }
  })

  it('o token é de uso único: consumido no envio e o widget é resetado (sucesso ou falha)', () => {
    const hook = readCode('features/auth/use-captcha.ts')
    expect(hook).toMatch(/setToken\(null\)/)
    expect(hook).toMatch(/setResetKey\(\(key\) => key \+ 1\)/)
    expect(readCode('components/auth/TurnstileWidget.tsx')).toMatch(/window\.turnstile\.reset\(widgetIdRef\.current\)/)
  })

  it('o token nunca é persistido (storage/cookie/URL), registrado (console) nem enviado ao Sentry', () => {
    for (const file of [
      'features/auth/use-captcha.ts',
      'components/auth/TurnstileWidget.tsx',
      'lib/captcha/captcha-client.ts',
      'app/login/page.tsx',
      'app/forgot-password/page.tsx',
      'features/auth/components/LoginForm.tsx',
      'features/auth/components/ForgotPasswordForm.tsx',
      'features/auth/components/SignupForm.tsx',
    ]) {
      const code = readCode(file)
      expect(code, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|history\.(push|replace)State|searchParams\.set|URLSearchParams/)
      expect(code, file).not.toMatch(/console\.|Sentry|captureException|captureMessage/)
    }
  })

  it('a tela /auth/reset-password NÃO usa CAPTCHA (a credencial é o link de recuperação já validado pelo Supabase)', () => {
    const code = readCode('app/auth/reset-password/page.tsx')
    expect(code).not.toMatch(/captcha|turnstile/i)
    expect(code).toMatch(/authRepository\.updatePassword\(password\)/)
  })

  it('a senha nunca vai ao Sentry em login/reset (o repositório não captura nada nesses métodos)', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials', message: 'x' } })
    await createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123', TOKEN).catch(() => {})
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: { code: 'over_email_send_rate_limit', message: 'x' } })
    await createSupabaseAuthRepository().requestPasswordReset('a@example.com', TOKEN).catch(() => {})
    expect(captureException).not.toHaveBeenCalled()
  })

  it('nenhum console.* é chamado nos fluxos de login/reset do repositório', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    await createSupabaseAuthRepository().signInWithPassword('a@example.com', 'Senha@123', TOKEN)
    await createSupabaseAuthRepository().requestPasswordReset('a@example.com', TOKEN)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('site key no navegador (lib/captcha/captcha-client.ts)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function load(value: string | undefined) {
    if (value === undefined) vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    else vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', value)
    vi.resetModules()
    return (await import('@/lib/captcha/captcha-client')).CLIENT_TURNSTILE_SITE_KEY
  }

  it('CAPTCHA configurado corretamente: site key não vazia é lida (e aparada)', async () => {
    expect(await load(' 0x4AAAAAAAsitekey ')).toBe('0x4AAAAAAAsitekey')
  })

  it.each([undefined, '', '   '])('CAPTCHA ausente (%j) → null (nenhum widget)', async (value) => {
    expect(await load(value)).toBeNull()
  })

  it('o acesso é LITERAL a process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY (única forma que o Next inlina no bundle) e só a chave pública é lida', () => {
    const code = readCode('lib/captcha/captcha-client.ts')
    expect(code).toMatch(/process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY\?\.trim\(\)/)
    expect(code.match(/process\.env\.[A-Z_]+/g)).toEqual(['process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY'])
  })

  it('o hook usa a site key do cliente por padrão e aceita a do servidor (cadastro)', () => {
    const hook = readCode('features/auth/use-captcha.ts')
    expect(hook).toMatch(/siteKey: string \| null = CLIENT_TURNSTILE_SITE_KEY/)
    expect(hook).toMatch(/enabled: siteKey !== null/)
  })
})

describe('Etapa B2.5.2 — login/forgot-password viraram Server Components fail-closed', () => {
  const loginPage = readCode('app/login/page.tsx')
  const forgotPage = readCode('app/forgot-password/page.tsx')

  it.each([
    ['login', 'app/login/page.tsx', 'LoginForm'],
    ['forgot-password', 'app/forgot-password/page.tsx', 'ForgotPasswordForm'],
  ])('%s: resolve a política no servidor e, se !ok, mostra indisponibilidade em vez do formulário', (_label, file, formName) => {
    const code = readCode(file)
    expect(code).not.toMatch(/^\s*['"]use client['"]/m)
    expect(code).toMatch(/resolveClientCaptchaPolicy\(process\.env\)/)
    expect(code).toMatch(/if \(!captcha\.ok\)/)
    expect(code).toMatch(new RegExp(`<${formName} captchaSiteKey=\\{captcha\\.siteKey\\} />`))
    expect(code).not.toMatch(/TURNSTILE_SECRET_KEY/)
  })

  it('nenhuma das duas páginas importa a secret do Turnstile nem o verificador de servidor do cadastro', () => {
    for (const code of [loginPage, forgotPage]) {
      expect(code).not.toMatch(/turnstile-server|checkTurnstileServerConfig|resolveSignupCaptchaPolicy|TURNSTILE_SECRET/)
    }
  })
})

describe('secrets nunca no bundle', () => {
  const staticDir = path.join(ROOT, '.next', 'static')

  function listJs(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) listJs(full, out)
      else if (/\.(js|css|map)$/.test(entry)) out.push(full)
    }
    return out
  }

  it.skipIf(!existsSync(staticDir))('nenhum valor de secret do ambiente e nenhum nome de secret aparece em .next/static (bundle do navegador)', () => {
    const secretValues = Object.entries(process.env)
      .filter(([name, value]) => /SERVICE_ROLE|SECRET|WEBHOOK|API_KEY|PRIVATE/i.test(name) && typeof value === 'string' && value.length >= 20)
      .map(([, value]) => value as string)

    const files = listJs(staticDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const value of secretValues) {
        expect(content.includes(value), `valor de secret encontrado em ${path.relative(ROOT, file)}`).toBe(false)
      }
      expect(content, path.relative(ROOT, file)).not.toMatch(/TURNSTILE_SECRET|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RESEND_API_KEY/)
    }
  })
})
