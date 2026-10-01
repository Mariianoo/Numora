/**
 * tests/unit/captcha-and-csp.test.ts — Etapa "B2 — Signup + Legal".
 * Abstração de CAPTCHA (Turnstile), CSP condicional e ausência de secrets no
 * código que vai ao navegador.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CAPTCHA_TOKEN_MAX_LENGTH,
  checkCaptchaToken,
  getTurnstileSiteKey,
  isCaptchaEnabled,
  isCaptchaRequired,
  resolveClientCaptchaPolicy,
  resolveSignupCaptchaPolicy,
} from '@/lib/captcha/captcha'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) listFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('CAPTCHA — configuração', () => {
  it('desligado por padrão (sem site key)', () => {
    expect(isCaptchaEnabled({})).toBe(false)
    expect(getTurnstileSiteKey({})).toBeNull()
    expect(getTurnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '   ' })).toBeNull()
  })

  it('ligado só com uma site key não vazia', () => {
    expect(isCaptchaEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toBe(true)
    expect(getTurnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' k ' })).toBe('k')
  })
})

describe('CAPTCHA — checkCaptchaToken', () => {
  const on = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' }

  it('integração desligada: qualquer entrada é ok e o token é DESCARTADO', () => {
    for (const token of [undefined, null, '', 'abc', 123]) {
      expect(checkCaptchaToken(token, {})).toEqual({ ok: true, token: undefined })
    }
  })

  it.each([undefined, null, ''])('ligado + token ausente (%j) → missing', (token) => {
    expect(checkCaptchaToken(token, on)).toEqual({ ok: false, reason: 'missing' })
  })

  it.each([[12345], [{}], [['a']], ['com espaço'], ['quebra\nlinha'], ['a'.repeat(CAPTCHA_TOKEN_MAX_LENGTH + 1)]])('ligado + token inválido (%j) → invalid', (token) => {
    expect(checkCaptchaToken(token, on)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('ligado + token bem formado → ok com o token', () => {
    expect(checkCaptchaToken('0.abcDEF_123-xyz', on)).toEqual({ ok: true, token: '0.abcDEF_123-xyz' })
    expect(checkCaptchaToken('a'.repeat(CAPTCHA_TOKEN_MAX_LENGTH), on).ok).toBe(true)
  })
})

describe('CAPTCHA_REQUIRED — política explícita (Etapa B2.5.2, substitui VERCEL_ENV)', () => {
  it('isCaptchaRequired: só o valor EXATO "true" ativa (fail-closed, mesma convenção de SIGNUP_ENABLED)', () => {
    expect(isCaptchaRequired({ CAPTCHA_REQUIRED: 'true' })).toBe(true)
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
      expect(isCaptchaRequired({ CAPTCHA_REQUIRED: value })).toBe(false)
    }
  })

  it('VERCEL_ENV sozinho NUNCA mais decide obrigatoriedade (a dependência implícita foi removida)', () => {
    // Em Production, sem CAPTCHA_REQUIRED e sem nenhuma chave, o cadastro NÃO é mais bloqueado por isso.
    expect(resolveSignupCaptchaPolicy({ VERCEL_ENV: 'production' })).toEqual({ ok: true, state: 'disabled' })
    expect(resolveClientCaptchaPolicy({ VERCEL_ENV: 'production' })).toEqual({ ok: true, required: false, siteKey: null })
  })

  describe('resolveSignupCaptchaPolicy (cadastro — verificação é NOSSA)', () => {
    it('CAPTCHA_REQUIRED=false/ausente + sem chaves → disabled (comportamento anterior preservado)', () => {
      expect(resolveSignupCaptchaPolicy({})).toEqual({ ok: true, state: 'disabled' })
      expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'false' })).toEqual({ ok: true, state: 'disabled' })
    })

    it('CAPTCHA_REQUIRED=true + sem chaves → fail-closed', () => {
      expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'true' })).toEqual({ ok: false })
    })

    it('CAPTCHA_REQUIRED=true + as duas chaves → enabled, com a secret', () => {
      expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET_KEY: 's' })).toEqual({
        ok: true,
        state: 'enabled',
        siteKey: 'k',
        secret: 's',
      })
    })

    it('configuração pela metade é SEMPRE ok:false, com ou sem CAPTCHA_REQUIRED', () => {
      for (const required of [undefined, 'true', 'false']) {
        expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: required, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: false })
        expect(resolveSignupCaptchaPolicy({ CAPTCHA_REQUIRED: required, TURNSTILE_SECRET_KEY: 's' })).toEqual({ ok: false })
      }
    })

    it('com as duas chaves, o token é verificado mesmo sem CAPTCHA_REQUIRED=true (preserva o comportamento já existente)', () => {
      expect(resolveSignupCaptchaPolicy({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET_KEY: 's' })).toMatchObject({ ok: true, state: 'enabled' })
    })
  })

  describe('resolveClientCaptchaPolicy (login/forgot-password — verificação é do Supabase)', () => {
    it('CAPTCHA_REQUIRED=false/ausente + sem site key → ok, opcional, sem widget (comportamento anterior)', () => {
      expect(resolveClientCaptchaPolicy({})).toEqual({ ok: true, required: false, siteKey: null })
    })

    it('CAPTCHA_REQUIRED=false + site key presente → ok, opcional, com widget', () => {
      expect(resolveClientCaptchaPolicy({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: true, required: false, siteKey: 'k' })
    })

    it('CAPTCHA_REQUIRED=true + sem site key → fail-closed (a página não pode funcionar)', () => {
      expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true' })).toEqual({ ok: false })
    })

    it('CAPTCHA_REQUIRED=true + site key presente → ok, obrigatório', () => {
      expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: true, required: true, siteKey: 'k' })
    })

    it('para login/reset a secret do SERVIDOR (TURNSTILE_SECRET_KEY) é irrelevante — só a site key importa', () => {
      expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET_KEY: 's' })).toEqual({
        ok: true,
        required: true,
        siteKey: 'k',
      })
      expect(resolveClientCaptchaPolicy({ CAPTCHA_REQUIRED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toEqual({ ok: true, required: true, siteKey: 'k' })
    })
  })
})

describe('CAPTCHA — nenhum secret no código do cliente', () => {
  const clientFiles = ['app', 'components', 'features', 'lib']
    .flatMap((dir) => listFiles(path.join(ROOT, dir)))
    .filter((file) => !file.includes(`${path.sep}api${path.sep}`))

  it('a secret do Turnstile e o siteverify só existem em módulos de SERVIDOR (lib/captcha), nunca em app/components/features', () => {
    const offenders = clientFiles
      .filter((file) => /TURNSTILE_SECRET|challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/i.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
      .sort()
    expect(offenders).toEqual(['lib/captcha/captcha.ts', 'lib/captcha/turnstile-server.ts'])
    // e esses módulos nunca são importados por um Client Component
    for (const file of clientFiles.filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/turnstile-server|checkTurnstileServerConfig|signup-config/)
    }
  })

  it('arquivos client ("use client") nunca leem process.env de secret nem importam o admin client', () => {
    const clientComponents = clientFiles.filter((file) => /^\s*['"]use client['"]/m.test(readFileSync(file, 'utf8')))
    expect(clientComponents.length).toBeGreaterThan(0)
    for (const file of clientComponents) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/SERVICE_ROLE|STRIPE_SECRET|STRIPE_WEBHOOK|RESEND_API_KEY|TURNSTILE_SECRET/)
      expect(source, file).not.toMatch(/lib\/supabase\/admin|env\.admin\.server/)
    }
  })

  it('a única variável do CAPTCHA no bundle é a site key PÚBLICA (CAPTCHA_REQUIRED e a secret nunca são lidas por código de cliente)', () => {
    const widget = read('components/auth/TurnstileWidget.tsx')
    expect(widget).not.toMatch(/process\.env/)
    const captcha = read('lib/captcha/captcha.ts')
    expect(captcha.match(/process\.env\.[A-Z_]+|env\.[A-Z_]+/g)?.filter((v) => !/NEXT_PUBLIC_TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|VERCEL_ENV|CAPTCHA_REQUIRED/.test(v)) ?? []).toEqual([])
    // lib/captcha/captcha.ts é server-only (usado só por Server Components/rotas) — CAPTCHA_REQUIRED
    // nunca é NEXT_PUBLIC_, então o Next.js nunca o inlina no bundle do cliente de qualquer forma.
    for (const file of ['features/auth/use-captcha.ts', 'lib/captcha/captcha-client.ts']) {
      // `CAPTCHA_REQUIRED_MESSAGE` (texto de UI, pré-existente) não conta — só a leitura da env var.
      expect(read(file)).not.toMatch(/\bCAPTCHA_REQUIRED\b(?!_MESSAGE)/)
    }
  })
})

describe('CSP — Turnstile só quando configurado, sem curingas', () => {
  const config = read('next.config.ts')

  it('o domínio da Cloudflare só entra na CSP condicionado à site key', () => {
    expect(config).toContain("const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'")
    expect(config).toMatch(/isTurnstileEnabled \? ` \$\{TURNSTILE_ORIGIN\}` : ''/)
    expect(config).toMatch(/isTurnstileEnabled \? `frame-src \$\{TURNSTILE_ORIGIN\}` : "frame-src 'none'"/)
  })

  it('sem a site key, script-src e frame-src ficam idênticos ao estado anterior à B2', () => {
    // O único caminho sem a variável é a string base — conferida literalmente.
    expect(config).toContain("`script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${")
    expect(config).toContain(`"frame-src 'none'"`)
  })

  it('nenhuma diretiva ganhou curinga (script-src * / connect-src * / frame-src *)', () => {
    expect(config).not.toMatch(/(script-src|connect-src|frame-src|default-src)[^\n]*\s\*[\s'",`]/)
    expect(config).not.toMatch(/cloudflare\.com\/\*|\*\.cloudflare/)
  })

  it('connect-src NÃO foi alterado (o Turnstile documentado só precisa de script-src e frame-src)', () => {
    expect(config).toContain(
      `"connect-src 'self' https://*.supabase.co https://*.ingest.us.sentry.io https://www.googletagmanager.com"`,
    )
  })
})

describe('CAPTCHA — repositório aceita token para signup/login/reset', () => {
  const repository = read('features/auth/repositories/auth.repository.ts')

  it('signInWithPassword e requestPasswordReset repassam captchaToken só quando informado', () => {
    expect(repository).toMatch(/signInWithPassword\(email: string, password: string, captchaToken\?: string\)/)
    expect(repository).toMatch(/requestPasswordReset\(email: string, captchaToken\?: string\)/)
    expect(repository).toMatch(/\.\.\.\(captchaToken \? \{ options: \{ captchaToken \} \} : \{\}\)/)
    expect(repository).toMatch(/\.\.\.\(captchaToken \? \{ captchaToken \} : \{\}\)/)
  })

  it('sem token o login segue chamando o SDK sem `options` (comportamento anterior preservado)', () => {
    const page = read('features/auth/components/LoginForm.tsx') // Etapa B2.5.2: lógica movida para cá
    expect(page).toMatch(/authRepository\.signInWithPassword\(email, password\)/)
  })
})
