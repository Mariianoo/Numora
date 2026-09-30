/**
 * tests/unit/b24-security-regression.test.ts — Etapa "B2.4 — Signup
 * server-controlled". Auditoria por inspeção do código-fonte (sem jsdom neste
 * repositório): o cadastro só existe pelo servidor, nenhum secret/token vai
 * ao navegador ou a logs, a confirmação só consome o token por POST, o
 * cleanup é fail-closed e restrito, e nada fora do escopo foi tocado.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.claude', 'test-results', 'tests', 'supabase'].includes(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')
const stripCode = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
const code = (file: string) => stripCode(readFileSync(path.join(ROOT, file), 'utf8'))
const raw = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

const SOURCE_FILES = ['app', 'components', 'features', 'lib', 'proxy.ts'].flatMap((entry) => {
  const full = path.join(ROOT, entry)
  return statSync(full).isDirectory() ? walk(full) : [full]
})

describe('nenhum caminho de criação de conta fora do servidor controlado', () => {
  it('supabase.auth.signUp() nunca é chamado em código do app (browser ou servidor)', () => {
    const offenders = SOURCE_FILES.filter((file) => /\.auth\.signUp\(/.test(stripCode(readFileSync(file, 'utf8')))).map(rel)
    expect(offenders).toEqual([])
  })

  it('nenhum código chama signInWithOtp (criação por OTP/magic link) — o login usa só e-mail/senha', () => {
    const offenders = SOURCE_FILES.filter((file) => /signInWithOtp\(/.test(stripCode(readFileSync(file, 'utf8')))).map(rel)
    expect(offenders).toEqual([])
  })

  it('Google OAuth continua desligado na UI (só o método legado existe no repositório)', () => {
    const offenders = SOURCE_FILES.filter((file) => /signInWithGoogle\(\)/.test(stripCode(readFileSync(file, 'utf8')))).map(rel)
    expect(offenders).toEqual(['features/auth/repositories/auth.repository.ts'])
  })

  it('a Admin API de Auth só é usada nos módulos de servidor esperados', () => {
    const offenders = SOURCE_FILES.filter((file) => /auth\.admin\./.test(stripCode(readFileSync(file, 'utf8')))).map(rel).sort()
    expect(offenders).toEqual(['app/api/account/delete/route.ts', 'app/api/internal/signup-cleanup/route.ts', 'lib/auth/signup-adapters.ts'])
  })

  it('o client service_role só é importado em rotas/módulos de servidor (nunca Client Component)', () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(file, 'utf8')
      if (!/lib\/supabase\/admin|getSupabaseAdminClient/.test(stripCode(source))) continue
      expect(/^\s*['"]use client['"]/m.test(source), rel(file)).toBe(false)
      expect(rel(file), 'só rotas/handlers de servidor').toMatch(/^app\/api\/|^lib\/supabase\/admin\.ts$|^app\/admin\/|^app\/dashboard\/(page|layout)|^features\/admin\//)
    }
  })

  it('nenhum código do app confia em metadata do cliente como consentimento', () => {
    const offenders = SOURCE_FILES.filter((file) => /user_metadata\??\.(terms|privacy|age|legal|marketing)/i.test(stripCode(readFileSync(file, 'utf8')))).map(rel)
    expect(offenders).toEqual([])
    for (const file of ['lib/auth/signup-handler.ts', 'lib/auth/signup-adapters.ts']) {
      expect(code(file)).not.toMatch(/terms_accepted|privacy_accepted|age18|age_18_version/)
    }
  })
})

describe('/auth/confirm — o token só é consumido por POST explícito', () => {
  const page = code('app/auth/confirm/page.tsx')
  const route = code('app/api/auth/confirm/route.ts')

  it('a PÁGINA (GET) nunca chama verifyOtp; só mostra um formulário POST para a API', () => {
    expect(page).not.toMatch(/verifyOtp|exchangeCodeForSession|supabase/i)
    expect(page).toMatch(/<form method="POST" action="\/api\/auth\/confirm"/)
    expect(page).toMatch(/type="hidden" name="token_hash"/)
  })

  it('a ROTA exporta somente POST (GET/PUT/DELETE inexistentes) e usa type=signup fixo', () => {
    expect(route).toMatch(/export async function POST\(/)
    expect(route).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE|HEAD)\b/)
    expect(route).toMatch(/verifyOtp\(\{ token_hash: tokenHash, type: 'signup' \}\)/)
  })

  it('a página valida o formato do token e mostra mensagem neutra para link inválido', () => {
    expect(page).toMatch(/TOKEN_HASH_PATTERN\.test\(tokenHash\)/)
    expect(page).toMatch(/Link inválido ou expirado/)
    expect(page).not.toMatch(/console\.|Sentry/)
  })

  it('a rota nunca registra o token e o redirect vem do handler (destino fixo, sem parâmetro do request)', () => {
    expect(route).not.toMatch(/console\./)
    expect(route).toMatch(/NextResponse\.redirect\(result\.location, result\.status\)/)
    expect(route).not.toMatch(/searchParams|request\.url|nextUrl/)
  })

  it('a confirmação leva a /auth/set-password e a atribuição first-touch é gravada aqui', () => {
    expect(code('lib/auth/confirm-signup.ts')).toMatch(/SET_PASSWORD_PATH = '\/auth\/set-password'/)
    expect(route).toMatch(/persistAttributionFromCookie\(supabase, userId, attributionCookie\)/)
  })
})

describe('/auth/set-password — senha só depois da confirmação, pelo próprio usuário', () => {
  const page = code('app/auth/set-password/page.tsx')

  it('exige sessão (criada só por verifyOtp) e usa a política de senha + updateUser', () => {
    expect(page).toMatch(/authRepository\s*\.getSession\(\)/)
    expect(page).toMatch(/sessionState === 'missing'/)
    expect(page).toMatch(/validatePassword\(password\)\.valid/)
    expect(page).toMatch(/authRepository\.updatePassword\(password\)/)
  })

  it('nunca registra nem persiste a senha e não conhece a senha temporária', () => {
    expect(page).not.toMatch(/console\.|Sentry|localStorage|sessionStorage|generateDiscardedPassword|random-password/)
  })
})

describe('segredos e credenciais nunca em log, Sentry, resposta ou navegador', () => {
  const NEW_SERVER_FILES = [
    'lib/auth/signup-handler.ts',
    'lib/auth/signup-adapters.ts',
    'lib/auth/signup-config.ts',
    'lib/auth/confirm-signup.ts',
    'lib/auth/random-password.ts',
    'lib/auth/persist-attribution.ts',
    'lib/auth/pending-signup-cleanup.ts',
    'lib/captcha/turnstile-server.ts',
    'lib/email/resend.ts',
    'lib/email/signup-email.ts',
    'app/api/auth/signup/route.ts',
    'app/api/auth/confirm/route.ts',
    'app/api/internal/signup-cleanup/route.ts',
  ]

  it('nenhum console.* nos módulos novos de servidor', () => {
    for (const file of NEW_SERVER_FILES) expect(code(file), file).not.toMatch(/console\./)
  })

  it('token_hash, action_link, senha, chaves e secrets nunca vão a Sentry/captureAuthError', () => {
    for (const file of NEW_SERVER_FILES) {
      const source = code(file)
      const calls = source.match(/captureAuthError\([^)]*\)/g) ?? []
      for (const call of calls) expect(call, `${file}: ${call}`).not.toMatch(/tokenHash|token_hash|hashed_token|action_link|password|Password|apiKey|secret|captchaToken/)
    }
  })

  it('o adaptador nunca devolve action_link/email_otp (só o hashed_token, para o link do e-mail)', () => {
    const adapter = code('lib/auth/signup-adapters.ts')
    expect(adapter).not.toMatch(/return \{[^}]*action_link/)
    expect(adapter).not.toMatch(/email_otp/)
  })

  it('nenhuma secret é lida em código de navegador; as chaves de servidor só aparecem em lib/route de servidor', () => {
    const clientFiles = SOURCE_FILES.filter((file) => /^\s*['"]use client['"]/m.test(readFileSync(file, 'utf8')))
    expect(clientFiles.length).toBeGreaterThan(0)
    for (const file of clientFiles) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/RESEND_API_KEY|TURNSTILE_SECRET_KEY|CRON_SECRET|SERVICE_ROLE|STRIPE_SECRET/)
    }
    const holders = SOURCE_FILES.filter((file) => /RESEND_API_KEY|RESEND_FROM_EMAIL/.test(stripCode(readFileSync(file, 'utf8')))).map(rel)
    expect(holders).toEqual(['lib/auth/signup-config.ts'])
  })

  it('a resposta HTTP do signup é sempre no-store e só carrega ok/código/mensagem', () => {
    expect(code('app/api/auth/signup/route.ts')).toMatch(/NextResponse\.json\(result\.body, \{ status: result\.status, headers: \{ 'Cache-Control': 'no-store' \} \}\)/)
  })
})

describe('cleanup de pendentes — fail-closed e restrito', () => {
  const route = code('app/api/internal/signup-cleanup/route.ts')
  // B2.4.1: a versão vigente da função é a da migration de hardening (a original foi substituída).
  const migration = raw('supabase/migrations/20260926163946_harden_signup_ownership.sql')
  const original = raw('supabase/migrations/20260926005045_create_list_stale_pending_public_signups.sql')

  it('sem CRON_SECRET a rota responde 404 e sem o bearer correto responde 401 (comparação em tempo constante)', () => {
    expect(route).toMatch(/if \(!secret\) return new NextResponse\('Not found', \{ status: 404 \}\)/)
    expect(route).toMatch(/if \(!isAuthorized\(request, secret\)\) return new NextResponse\('Unauthorized', \{ status: 401 \}\)/)
    expect(route).toMatch(/timingSafeEqual/)
    expect(route.indexOf("process.env.CRON_SECRET")).toBeLessThan(route.indexOf('getSupabaseAdminClient()'))
  })

  it('NENHUM agendador foi criado (sem vercel.json / cron)', () => {
    expect(existsSync(path.join(ROOT, 'vercel.json'))).toBe(false)
    expect(existsSync(path.join(ROOT, '..', 'vercel.json'))).toBe(false)
  })

  it('a função do banco só lista o escopo seguro: não confirmado, nunca logou, marcador do fluxo, role user, fora das Contas de Análise', () => {
    for (const condition of [
      'u.email_confirmed_at is null',
      'u.last_sign_in_at is null',
      "u.raw_app_meta_data ->> 'signup_flow' = 'public_v1'",
      "coalesce(u.raw_app_meta_data ->> 'signup_attempt_nonce', '') <> ''",
      'from public.legal_consents c',
      "c.source = 'signup'",
      "p.role = 'user'",
      'internal_test_accounts',
      'u.is_anonymous = false',
      'u.created_at < p_cutoff',
    ]) {
      expect(migration, condition).toContain(condition)
    }
  })

  it('a função é SECURITY DEFINER com search_path vazio e executável SÓ por service_role', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/)
    expect(migration).toMatch(/revoke all on function public\.list_stale_pending_public_signups\(timestamptz, integer\) from public, anon, authenticated/)
    expect(migration).toMatch(/grant execute on function public\.list_stale_pending_public_signups\(timestamptz, integer\) to service_role/)
    expect(migration).toMatch(/revoke all on function public\.get_auth_user_id_by_email\(text\) from public, anon, authenticated/)
    expect(migration).toMatch(/grant execute on function public\.get_auth_user_id_by_email\(text\) to service_role/)
    expect(migration.match(/^\s*grant\s/gim)).toHaveLength(2) // uma por função, ambas só service_role
    expect(migration.match(/^\s*grant\s.*$/gim)?.every((line) => /to service_role;$/.test(line.trim()))).toBe(true)
  })

  it('o cleanup NÃO depende de user_metadata (o próprio usuário logado a edita e o generateLink a sobrescreve)', () => {
    const executable = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    expect(executable).not.toMatch(/raw_user_meta_data/)
    expect(route).not.toMatch(/user_metadata/)
    expect(route).toMatch(/readOwnership\(user\.app_metadata\)\.ownedByPublicFlow/)
  })

  it('a função de lookup consulta auth.users (autoritativo) e nunca profiles', () => {
    const lookup = migration.slice(migration.indexOf('create or replace function public.get_auth_user_id_by_email'), migration.indexOf('create or replace function public.list_stale_pending_public_signups'))
    const executable = lookup.replace(/comment on function[\s\S]*$/, '').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    expect(executable).toMatch(/from auth\.users u/)
    expect(executable).not.toMatch(/profiles/)
  })

  it('a migration original (substituída) segue não aplicada em Production e a nova a substitui explicitamente', () => {
    expect(original).toMatch(/NÃO aplicada em\s+-- Production/)
    expect(migration).toMatch(/Substitui a versão de\s+-- `list_stale_pending_public_signups` da migration 20260926005045/)
  })

  it('a migration só lista: nenhum DELETE/UPDATE/INSERT/DROP e nada de billing', () => {
    const executable = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    expect(executable).not.toMatch(/\b(delete|update|insert|drop|truncate)\b/i)
    expect(executable).not.toMatch(/subscriptions|billing_|stripe_|plan_/i)
    expect(migration).toMatch(/NÃO aplicada em\s+-- Production/)
  })

  it('o marcador do fluxo é o mesmo em criação, adaptador, cleanup e migration', () => {
    expect(code('lib/auth/signup-handler.ts')).toMatch(/SIGNUP_FLOW_MARKER = 'public_v1'/)
    expect(code('lib/auth/signup-adapters.ts')).toMatch(/PUBLIC_FLOW_MARKER = 'public_v1'/)
    expect(route).toMatch(/readOwnership\(user\.app_metadata\)/)
    expect(migration).toContain("'public_v1'")
  })
})

describe('escopo: nada fora do B2.4 foi tocado', () => {
  it('billing, Premium, plano e Stripe não conhecem o novo fluxo', () => {
    for (const file of ['lib/billing/plan-availability.ts', 'lib/billing/purchase-eligibility.ts', 'app/api/billing/checkout/route.ts', 'app/api/stripe/webhook/route.ts']) {
      if (!existsSync(path.join(ROOT, file))) continue
      expect(code(file), file).not.toMatch(/signup|resend|turnstile|legal\//i)
    }
  })

  it('proxy.ts continua sem importar módulos do projeto e sem conhecer o cadastro', () => {
    const proxy = code('proxy.ts')
    expect(proxy).not.toMatch(/from '@\//)
    expect(proxy).not.toMatch(/SIGNUP_ENABLED|turnstile|resend|signup-/i)
  })

  it('o login e a recuperação de senha continuam chamando o GoTrue direto (só usuários existentes)', () => {
    const repository = code('features/auth/repositories/auth.repository.ts')
    expect(repository).toMatch(/supabase\.auth\.signInWithPassword\(/)
    expect(repository).toMatch(/supabase\.auth\.resetPasswordForEmail\(/)
  })

  it('handle_new_user segue sem gravar consentimento (migration final da B2.1 inalterada)', () => {
    const finalTrigger = raw('supabase/migrations/20260925234538_handle_new_user_stop_trusting_consent_metadata.sql')
    expect(finalTrigger.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')).not.toMatch(/legal_consents/)
  })
})
