/**
 * tests/unit/e2e-server-guard.test.ts — Etapa "B2.5.7.1".
 * As proteções dos E2E que exercitam o cadastro de verdade:
 *  F1 — o POST de cadastro VÁLIDO (auth.spec.ts) nunca roda contra um servidor remoto;
 *  F2 — o E2E de signup aberto só roda se o servidor local aponta para o Supabase DEV.
 * A decisão é pura (tests/support/local-server-guard.ts) e é provada aqui; a execução contra o servidor
 * está em tests/e2e/support/local-server.ts e é exercida pelo próprio E2E.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEV_PROJECT_REF, PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-ref'
import { DEFAULT_E2E_BASE_URL, extractSupabaseRefs, isLocalBaseURL, judgeServerSupabaseRefs, resolveE2EBaseURL } from '../support/local-server-guard'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

describe('F1 — isLocalBaseURL: só localhost e 127.0.0.1', () => {
  it.each(['http://localhost:3000', 'http://localhost', 'http://127.0.0.1:3000', 'http://127.0.0.1:3100/signup', 'https://localhost:3443'])('%s → local', (url) => {
    expect(isLocalBaseURL(url)).toBe(true)
  })

  it.each([
    ['Production (www)', 'https://www.numoracollect.com'],
    ['Production (apex)', 'https://numoracollect.com'],
    ['Preview da Vercel', 'https://numora-git-main-anzos-print-3d.vercel.app'],
    ['deployment da Vercel', 'https://numora-hnoj1rc7p-anzos-print-3d.vercel.app'],
    ['qualquer host remoto', 'https://app.numora.test'],
    ['localhost só como subdomínio', 'http://localhost.evil.com'],
    ['localhost só no caminho', 'http://evil.com/localhost'],
    ['localhost como credencial', 'http://localhost:3000@evil.com'],
    ['localhost como credencial (com senha)', 'http://localhost:pw@evil.com'],
    ['credenciais embutidas mesmo em host local', 'http://user:pw@localhost:3000'],
    ['127.0.0.1 só como prefixo de DNS', 'http://127.0.0.1.nip.io'],
    ['0.0.0.0', 'http://0.0.0.0:3000'],
    ['IPv6 loopback (fora da lista permitida)', 'http://[::1]:3000'],
    ['IP de rede privada', 'http://192.168.0.10:3000'],
    ['protocolo não http', 'ftp://localhost'],
    ['sem protocolo', 'localhost:3000'],
    ['URL inválida', 'não é uma url'],
    ['vazio', ''],
  ])('%s (%s) → remoto/inválido', (_label, url) => {
    expect(isLocalBaseURL(url)).toBe(false)
  })

  it('o baseURL padrão é local e a variável PLAYWRIGHT_BASE_URL tem precedência (mesma regra do playwright.config.ts)', () => {
    expect(DEFAULT_E2E_BASE_URL).toBe('http://localhost:3000')
    expect(isLocalBaseURL(DEFAULT_E2E_BASE_URL)).toBe(true)
    expect(resolveE2EBaseURL({})).toBe(DEFAULT_E2E_BASE_URL)
    expect(resolveE2EBaseURL({ PLAYWRIGHT_BASE_URL: 'https://www.numoracollect.com' })).toBe('https://www.numoracollect.com')
    expect(isLocalBaseURL(resolveE2EBaseURL({ PLAYWRIGHT_BASE_URL: 'https://www.numoracollect.com' }))).toBe(false)
  })

  it('o teste de POST válido em auth.spec.ts é pulado fora do local e NÃO depende só de E2E_SIGNUP_OPEN', () => {
    const spec = read('tests/e2e/auth.spec.ts')
    const start = spec.indexOf("test('fechado: POST /api/auth/signup")
    const end = spec.indexOf("test('/login continua disponível")
    const body = spec.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(body).toMatch(/test\.skip\(!isLocalBaseURL\(baseURL\)/)
    expect(body).toMatch(/test\.skip\(signupOpen/) // a regra antiga continua, mas não é a única
    // a guarda vem ANTES do envio
    expect(body.indexOf('isLocalBaseURL(baseURL)')).toBeLessThan(body.indexOf('request.post('))
    // a origem enviada é o baseURL, não um valor fixo
    expect(body).toMatch(/Origin: baseURL/)
    expect(spec).toMatch(/const baseURL = resolveE2EBaseURL\(\)/)
  })
})

describe('F2 — extractSupabaseRefs / judgeServerSupabaseRefs: o servidor local precisa apontar para o DEV', () => {
  const urlOf = (ref: string) => `https://${ref}.supabase.co`

  it('encontra o ref em código de chunk e em HTML, ignora o que não é URL de projeto', () => {
    const chunk = `const a="${urlOf(DEV_PROJECT_REF)}";fetch("${urlOf(DEV_PROJECT_REF)}/auth/v1/token");const docs="https://supabase.com/docs";const exemplo="https://project.supabase.co"`
    expect([...extractSupabaseRefs(chunk)]).toEqual([DEV_PROJECT_REF])
    expect([...extractSupabaseRefs(`<script>window.x="${urlOf(PRODUCTION_PROJECT_REF)}"</script>`)]).toEqual([PRODUCTION_PROJECT_REF])
    expect(extractSupabaseRefs('nada aqui').size).toBe(0)
  })

  it('só o ref do DEV → aprovado', () => {
    expect(judgeServerSupabaseRefs([DEV_PROJECT_REF, DEV_PROJECT_REF])).toEqual({ ok: true, ref: DEV_PROJECT_REF })
  })

  it('servidor apontando para PRODUCTION → reprovado (e continua reprovado se o DEV também aparecer)', () => {
    expect(judgeServerSupabaseRefs([PRODUCTION_PROJECT_REF])).toMatchObject({ ok: false, reason: 'production' })
    expect(judgeServerSupabaseRefs([DEV_PROJECT_REF, PRODUCTION_PROJECT_REF])).toMatchObject({ ok: false, reason: 'production' })
  })

  it('outro projeto qualquer → reprovado', () => {
    expect(judgeServerSupabaseRefs(['abcdefghijklmnopqrst'])).toMatchObject({ ok: false, reason: 'unexpected_project' })
    expect(judgeServerSupabaseRefs([DEV_PROJECT_REF, 'abcdefghijklmnopqrst'])).toMatchObject({ ok: false, reason: 'unexpected_project' })
  })

  it('nenhum ref encontrado → reprovado (sem prova não há permissão: falha fechado)', () => {
    expect(judgeServerSupabaseRefs([])).toEqual({ ok: false, reason: 'no_supabase_url_found', refs: [] })
    expect(judgeServerSupabaseRefs(new Set())).toMatchObject({ ok: false })
  })

  it('a decisão depende SÓ do ref — vale antes e depois de as migrations irem para Production', () => {
    const guard = read('tests/support/local-server-guard.ts')
    const code = guard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/rpc|migration|signup_rate_limits|legal_consents|from\(/i)
  })
})

describe('F2 — o spec do signup aberto usa a prova antes de qualquer teste com efeito', () => {
  const spec = read('tests/e2e/signup-open.spec.ts')
  const helper = read('tests/e2e/support/local-server.ts')

  it('o beforeAll chama assertServerUsesDevSupabase e o canário é removido no afterAll', () => {
    expect(spec).toMatch(/await assertServerUsesDevSupabase\(\{ baseURL, admin, onCanaryUser: \(id\) => userIds\.add\(id\) \}\)/)
    const beforeAll = spec.indexOf('test.beforeAll(')
    const firstTest = spec.indexOf("test('/signup mostra o formulário")
    expect(beforeAll).toBeGreaterThan(-1)
    expect(beforeAll).toBeLessThan(firstTest)
    expect(spec).toMatch(/for \(const id of userIds\) await deleteDisposableUser/)
  })

  it('o helper recusa remoto ANTES de qualquer escrita, reprova o ref errado e confirma por um canário no servidor', () => {
    expect(helper.indexOf('isLocalBaseURL(baseURL)')).toBeLessThan(helper.indexOf('admin.auth.admin.createUser'))
    expect(helper.indexOf('judgeServerSupabaseRefs(')).toBeLessThan(helper.indexOf('admin.auth.admin.createUser'))
    expect(helper).toMatch(/\/api\/auth\/confirm/)
    expect(helper).toMatch(/maxRedirects: 0/)
    expect(helper).toMatch(/PRODUCTION_PROJECT_REF/)
  })

  it('nenhum segredo: o helper não lê env de segredo, não cria client e não imprime chaves', () => {
    for (const text of [helper, read('tests/support/local-server-guard.ts'), spec]) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(code).not.toMatch(/SERVICE_ROLE|createClient\(|process\.env\.[A-Z_]*KEY|sb_secret|eyJ[A-Za-z0-9_-]{20,}|console\./)
    }
    expect(helper).not.toMatch(/process\.env/)
  })
})
