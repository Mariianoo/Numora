/**
 * tests/unit/b2-regression.test.ts — Etapa "B2 — Signup + Legal".
 * Regressão por inspeção do código-fonte (sem jsdom neste repositório — ver
 * a nota em tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts):
 * cadastro segue FECHADO por padrão, formulário só atrás da flag, migrations
 * seguras e nada de billing/Premium/Google foi reaberto.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { COMING_SOON_PLAN_SLUGS, PURCHASABLE_PLAN_SLUGS } from '@/lib/billing/plan-availability'
import { PURCHASE_ELIGIBLE_COUNTRY, PURCHASE_ELIGIBLE_CURRENCY } from '@/lib/billing/purchase-eligibility'

const ROOT = path.resolve(__dirname, '../..')

function readCode(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}
const readRaw = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

describe('/signup — fechado por padrão (fail-closed)', () => {
  const page = readCode('app/signup/page.tsx')
  const rawPage = readRaw('app/signup/page.tsx')

  it('a página decide no SERVIDOR, por requisição, e só abre com a flag exata + configuração completa do endpoint', () => {
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(page).toMatch(/if \(isSignupEnabled\(\) && resolveSignupConfig\(process\.env\)\.ok\)/)
    expect(page).toMatch(/return <ClosedSignup \/>/)
  })

  it('a tela de Beta Fechado continua exatamente como antes (título, texto, link "Já tenho acesso")', () => {
    expect(rawPage).toContain('Beta Fechado')
    expect(rawPage).toContain('O cadastro do Numora está temporariamente fechado.')
    expect(rawPage).toContain('Já tenho acesso')
    expect(rawPage).toContain("title: 'Beta Fechado — Numora'")
  })

  it('a flag nunca é lida como `!== "false"` em nenhum lugar do app', () => {
    for (const file of ['lib/auth/signup-flag.ts', 'lib/auth/signup-handler.ts', 'app/signup/page.tsx', 'app/api/auth/signup/route.ts']) {
      expect(readCode(file)).not.toMatch(/SIGNUP_ENABLED\s*!==?\s*['"]false['"]/)
    }
    expect(readCode('lib/auth/signup-flag.ts')).toMatch(/env\.SIGNUP_ENABLED === 'true'/)
  })

  it('a flag é server-only (nunca NEXT_PUBLIC_) e não existe fora do código de servidor', () => {
    expect(readRaw('lib/auth/signup-flag.ts')).not.toMatch(/NEXT_PUBLIC_SIGNUP/)
    expect(readCode('features/auth/components/SignupForm.tsx')).not.toMatch(/SIGNUP_ENABLED/)
  })

  it('a página não usa mais o admin client nem lista países (V1: só Brasil)', () => {
    expect(page).not.toMatch(/supabase\/admin|countries|getSupabaseAdminClient/)
  })

  it('a rota de cadastro existe atrás do handler fail-closed e é sempre dinâmica/no-store', () => {
    const route = readCode('app/api/auth/signup/route.ts')
    expect(route).toMatch(/handleSignupRequest\(request, \{/)
    expect(route).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(route).toMatch(/'Cache-Control': 'no-store'/)
    const handler = readCode('lib/auth/signup-handler.ts')
    expect(handler.indexOf('isSignupEnabled(deps.env)')).toBeLessThan(handler.indexOf('readJsonBody(request)'))
    expect(handler.indexOf('isAllowedRequestOrigin(request')).toBeLessThan(handler.indexOf('readJsonBody(request)'))
    expect(handler.indexOf('deps.verifyCaptcha(')).toBeLessThan(handler.indexOf('deps.admin.generateSignupLink('))
  })

  it('o service_role só é usado no servidor (rota e página), nunca no formulário/repositório do cliente', () => {
    for (const file of ['features/auth/components/SignupForm.tsx', 'features/auth/repositories/auth.repository.ts', 'components/auth/TurnstileWidget.tsx']) {
      expect(readCode(file)).not.toMatch(/supabase\/admin|SERVICE_ROLE|getAdminEnv/)
    }
  })
})

describe('formulário de cadastro futuro — consentimento correto', () => {
  const form = readCode('features/auth/components/SignupForm.tsx')

  it('Termos, Privacidade, 18+ e marketing começam DESMARCADOS (nunca pré-marcados)', () => {
    for (const state of ['termsAccepted', 'privacyAccepted', 'age18Confirmed', 'marketingOptIn']) {
      expect(form).toMatch(new RegExp(`\\[${state}, set\\w+\\] = useState\\(false\\)`))
    }
    expect(form).not.toMatch(/defaultChecked|checked=\{true\}/)
  })

  it('o texto do 18+ vem da constante aprovada e o marketing é um checkbox SEPARADO e opcional', () => {
    expect(form).toMatch(/\{AGE_CONFIRMATION_TEXT\}/)
    expect(form).toMatch(/id="signup-marketing"/)
    expect(form).toMatch(/\(opcional\)/)
    expect(form).toMatch(/id="signup-terms"/)
    expect(form).toMatch(/id="signup-privacy"/)
    expect(form).toMatch(/id="signup-age"/)
  })

  it('NÃO coleta data de nascimento', () => {
    expect(form).not.toMatch(/nascimento|birth|dob|birthday|date_of_birth/i)
  })

  it('país é fixo em Brasil (a V1 só aceita BR; o servidor valida) e a validação usa a função pura compartilhada', () => {
    expect(form).toMatch(/countryCode: SIGNUP_ALLOWED_COUNTRY/)
    expect(form).toMatch(/value="Brasil" readOnly/)
    expect(form).toMatch(/validateSignupPayload\(payload\)/)
  })

  it('NÃO existe campo de senha no cadastro (a senha é definida depois de confirmar o e-mail)', () => {
    expect(form).not.toMatch(/PasswordInput|type="password"|confirmPassword|autoComplete="new-password"/)
    expect(form).toMatch(/depois de confirmar o e-mail/)
  })

  it('envia as versões vigentes ecoadas e nunca registra dados do usuário', () => {
    expect(form).toMatch(/termsVersion: TERMS_VERSION/)
    expect(form).toMatch(/privacyVersion: PRIVACY_VERSION/)
    expect(form).toMatch(/ageConfirmationVersion: AGE_CONFIRMATION_VERSION/)
    expect(form).not.toMatch(/console\.|Sentry|localStorage|sessionStorage/)
  })

  it('o CAPTCHA só aparece com site key e o token é exigido antes do envio', () => {
    expect(form).toMatch(/\{captcha\.siteKey && <TurnstileWidget/)
    expect(form).toMatch(/if \(captcha\.enabled && !captcha\.token\)/)
    expect(form).toMatch(/useCaptcha\(captchaSiteKey\)/)
  })

  it('a confirmação de e-mail não revela se o e-mail já existia', () => {
    expect(form).toMatch(/Se o cadastro puder ser concluído/)
    expect(form).not.toMatch(/já existe|já cadastrado|já possui/i)
  })
})

describe('repositório de auth', () => {
  const repository = readCode('features/auth/repositories/auth.repository.ts')

  it('signUp passa pela rota do servidor e NÃO chama mais supabase.auth.signUp no navegador', () => {
    expect(repository).toMatch(/fetch\('\/api\/auth\/signup'/)
    expect(repository).not.toMatch(/supabase\.auth\.signUp\(/)
  })

  it('não faz mais o UPDATE de country_code nem grava atribuição no navegador (o trigger e a confirmação cuidam disso)', () => {
    expect(repository).not.toMatch(/update\(\{ country_code/)
    expect(repository).not.toMatch(/user_acquisition|getStoredAttribution/)
  })

  it('Google OAuth continua NÃO habilitado na UI (só o método legado existe, sem uso)', () => {
    for (const file of ['app/login/page.tsx', 'app/signup/page.tsx', 'features/auth/components/SignupForm.tsx']) {
      expect(readCode(file)).not.toMatch(/signInWithGoogle|Google/)
    }
  })
})

describe('migrations B2 (DEV/repo — candidatas a promoção, não aplicadas em Production)', () => {
  const create = readRaw('supabase/migrations/20260925163425_create_legal_consents.sql')
  const trigger = readRaw('supabase/migrations/20260925163435_handle_new_user_country_and_consents.sql')
  const finalTrigger = readRaw('supabase/migrations/20260925234538_handle_new_user_stop_trusting_consent_metadata.sql')

  it('legal_consents: RLS habilitada, SELECT own + admin, nenhuma policy de escrita', () => {
    expect(create).toMatch(/alter table public\.legal_consents enable row level security/)
    expect(create).toMatch(/create policy "legal_consents_select_own"[\s\S]*for select[\s\S]*auth\.uid\(\)\) = user_id/)
    expect(create).toMatch(/create policy "legal_consents_select_admin"[\s\S]*is_platform_admin\(\)/)
    expect(create.match(/create policy/g)).toHaveLength(2)
    expect(create).not.toMatch(/for (insert|update|delete|all)/i)
  })

  it('grants: anon sem nada; authenticated só SELECT; sem GRANT concedido a ninguém', () => {
    expect(create).toMatch(/revoke all on table public\.legal_consents from anon/)
    expect(create).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.legal_consents from authenticated/)
    expect(create).not.toMatch(/^\s*grant\s/im)
  })

  it('append-only: trigger rejeita UPDATE e a FK usa cascade só para a exclusão de conta', () => {
    expect(create).toMatch(/create trigger legal_consents_no_update[\s\S]*before update on public\.legal_consents/)
    expect(create).toMatch(/references auth\.users \(id\) on delete cascade/)
  })

  it('colunas e constraints exigidas (tipo controlado, versão obrigatória, accepted_at do servidor, source obrigatório)', () => {
    expect(create).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/)
    expect(create).toMatch(/document_type\s+text not null[\s\S]*check \(document_type in \('terms', 'privacy', 'cookies', 'age_18', 'marketing_email'\)\)/)
    expect(create).toMatch(/document_version\s+text not null[\s\S]*check \(document_version ~/)
    expect(create).toMatch(/accepted_at\s+timestamptz not null default now\(\)/)
    expect(create).toMatch(/source\s+text not null/)
  })

  it('handle_new_user (versão FINAL): continua SECURITY DEFINER com search_path fixo e idempotente; país validado contra countries; NÃO grava consentimento', () => {
    expect(finalTrigger).toMatch(/security definer\s+set search_path = public/)
    expect(finalTrigger).toMatch(/on conflict \(id\) do nothing/)
    expect(finalTrigger).toMatch(/v_country !~ '\^\[A-Z\]\{2\}\$'/)
    expect(finalTrigger).toMatch(/c\.type = 'sovereign_state'/)
    expect(finalTrigger).not.toMatch(/raise exception/i)
    // Nenhum comando toca legal_consents (o texto dos comentários explicativos pode citá-la).
    const executable = finalTrigger
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .replace(/comment on function[\s\S]*$/, '')
    expect(executable).not.toMatch(/legal_consents|_version|age_18|terms|privacy/i)
  })

  it('a migration intermediária (163435) foi SUPERSEDIDA pela final (234538), que a substitui e explica o porquê', () => {
    expect(trigger).toMatch(/insert into public\.legal_consents/)
    expect(finalTrigger).toMatch(/SUPERSEDE a parte de/)
    expect(finalTrigger).toMatch(/PROVA\s+(--\s+)?JURÍDICA FALSA/)
    expect('20260925234538' > '20260925163435').toBe(true)
  })

  it('as migrations NÃO tocam billing, planos, entitlements, Stripe nem policies de outras tabelas', () => {
    for (const sql of [create, trigger, finalTrigger]) {
      expect(sql).not.toMatch(/plan_prices|plan_entitlements|subscriptions|billing_|stripe_|entitlement/i)
      expect(sql).not.toMatch(/drop (table|policy|function)/i)
    }
  })

  it('nenhuma migration Production-only foi criada nesta etapa (as duas *_production seguem as pré-existentes)', () => {
    for (const sql of [create, trigger, finalTrigger]) {
      expect(sql).toMatch(/NÃO aplicada em\s+-- Production|NÃO aplicada em Production/)
    }
  })
})

describe('regressão — billing B1/Premium/Passport permanecem intactos', () => {
  it('Premium segue "Em breve" e Pro é o único plano contratável', () => {
    expect([...PURCHASABLE_PLAN_SLUGS]).toEqual(['pro'])
    expect([...COMING_SOON_PLAN_SLUGS]).toEqual(['premium'])
  })

  it('elegibilidade de compra segue somente Brasil/BRL (sem fallback USD)', () => {
    expect(PURCHASE_ELIGIBLE_COUNTRY).toBe('BR')
    expect(PURCHASE_ELIGIBLE_CURRENCY).toBe('BRL')
  })

  it('a B2 não alterou nenhum arquivo de billing/Stripe/plano (imports novos ausentes)', () => {
    for (const file of [
      'lib/billing/plan-availability.ts',
      'lib/billing/purchase-eligibility.ts',
      'lib/billing/checkout-return.ts',
      'app/api/billing/checkout/route.ts',
      'app/api/billing/subscription/change-plan/route.ts',
    ]) {
      expect(readCode(file)).not.toMatch(/lib\/legal|lib\/captcha|signup-flag|SIGNUP_ENABLED/)
    }
  })

  it('proxy.ts segue sem importar módulos do projeto e sem conhecer a flag (Maintenance/auth guard intactos)', () => {
    const proxy = readCode('proxy.ts')
    expect(proxy).not.toMatch(/from '@\//)
    expect(proxy).not.toMatch(/SIGNUP_ENABLED|captcha|turnstile/i)
  })
})

describe('fronteira de confiança do consentimento (B2.1)', () => {
  it('só o servidor grava legal_consents: nenhum código do navegador/cliente referencia a tabela', () => {
    for (const file of ['features/auth/components/SignupForm.tsx', 'features/auth/repositories/auth.repository.ts', 'app/login/page.tsx', 'app/forgot-password/page.tsx', 'components/auth/TurnstileWidget.tsx']) {
      expect(readCode(file)).not.toMatch(/legal_consents/)
    }
  })

  it('a gravação usa o client service_role injetado pela rota e valores das constantes (nunca do payload)', () => {
    const route = readCode('app/api/auth/signup/route.ts')
    expect(route).toMatch(/recordSignupConsents\(getSupabaseAdminClient\(\), userId, consents\)/)
    const recorder = readCode('lib/legal/signup-consents.ts')
    expect(recorder).toMatch(/from '@\/lib\/legal\/versions'/)
    expect(recorder).toMatch(/source: SIGNUP_CONSENT_SOURCE/)
    expect(readCode('lib/auth/signup-handler.ts')).toMatch(/deps\.recordConsents\(userId, data\.consents\)/)
  })

  it('a metadata enviada ao GoTrue não carrega versão/aceite/18+ (só nome, país e o marcador do fluxo)', () => {
    const validation = readCode('lib/auth/signup-validation.ts')
    expect(validation).not.toMatch(/terms_version|privacy_version|age_18_version|marketing_email_version|terms_accepted|privacy_accepted/)
    const handler = readCode('lib/auth/signup-handler.ts')
    // B2.4.1: o marcador vai em app_metadata (server-only), nunca em user_metadata.
    expect(handler).toMatch(/userMetadata: \{ name: data\.name, country_code: data\.countryCode \}/)
    expect(handler).toMatch(/appMetadata: \{ signup_flow: SIGNUP_FLOW_MARKER, signup_attempt_nonce: nonce, signup_state: 'provisioning' \}/)
    expect(handler).not.toMatch(/terms_|privacy_|age18|age_18/)
  })

  it('o rollback é OWNERSHIP-AWARE (nonce), nunca heurística de tempo, e-mail ou profile', () => {
    const handler = readCode('lib/auth/signup-handler.ts')
    expect(handler).toMatch(/async function rollbackIfOwned\(\)/)
    expect(handler).toMatch(/isOwnedByAttempt\(current, nonce\)/)
    expect(handler).not.toMatch(/isFresh|SIGNUP_NEW_USER_MAX_AGE_MS|findProfileIdByEmail|profiles/)
    // toda chamada a deleteUser está dentro do rollback ownership-aware
    expect(handler.match(/deps\.admin\.deleteUser\(/g)).toHaveLength(1)
    expect(handler.indexOf('deps.admin.deleteUser(')).toBeGreaterThan(handler.indexOf('isOwnedByAttempt(current, nonce)'))
  })

  it('a exclusão do usuário recém-criado usa a Admin API só no adaptador de servidor', () => {
    expect(readCode('lib/auth/signup-adapters.ts')).toMatch(/auth\.admin\.deleteUser\(userId\)/)
  })
})
