/**
 * tests/unit/b1-regression.test.ts
 * Etapa "B1 — Official Launch, código de cobrança" — orquestração das
 * peças do B1 que não dá para exercitar por comportamento neste repositório
 * (sem jsdom/testing-library, `environment: 'node'`: não é possível renderizar
 * páginas Server/Client Components). A REGRA de elegibilidade, o retorno do
 * checkout, os avisos e o login já têm comportamento real coberto em
 * purchase-eligibility/checkout-return/billing-notices/login-error-message/
 * premium-purchase-guard — aqui só a COSTURA, por inspeção do código-fonte,
 * sobre o código (comentários removidos: os cabeçalhos dos arquivos citam em
 * prosa exatamente os termos proibidos, o que geraria falso-positivo).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

function readCode(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('Servidor — a política de elegibilidade vem depois da autenticação e antes de Stripe/catálogo/Customer', () => {
  it('checkout: auth → guarda de plano → país do PERFIL → política → só então Stripe/catálogo/Customer/Session', () => {
    const route = readCode('app/api/billing/checkout/route.ts')
    const auth = route.indexOf('sessionClient.auth.getUser()')
    const planGuard = route.indexOf('isPlanPurchasable(planSlug)')
    const loadCountry = route.indexOf('loadOwnCountryCode(sessionClient, user.id)')
    const policy = route.indexOf('evaluatePurchaseEligibility({ countryCode, currency })')
    const stripeClient = route.indexOf('getStripeClient()')
    const catalog = route.indexOf('getCommercialPlanPricesCatalog(sessionClient)')
    const customer = route.indexOf('getOrCreateBillingCustomer(')
    const session = route.indexOf('createCheckoutSession(stripe')

    expect(auth).toBeGreaterThan(-1)
    expect(planGuard).toBeGreaterThan(auth)
    expect(loadCountry).toBeGreaterThan(planGuard)
    expect(policy).toBeGreaterThan(loadCountry)
    for (const external of [stripeClient, catalog, customer, session]) {
      expect(external).toBeGreaterThan(policy)
    }
  })

  it('checkout: o país NUNCA vem do body (só planSlug/interval/currency são lidos) e o resto do fluxo usa a moeda DERIVADA', () => {
    const route = readCode('app/api/billing/checkout/route.ts')
    expect(route).toMatch(/const \{ planSlug, interval, currency \} = parsed\.data/)
    expect(route).not.toMatch(/parsed\.data\.country|rawBody[^\n]*country|body\.country/i)
    expect(route).toMatch(/const billingCurrency = eligibility\.currency/)
    expect(route).toMatch(/resolveSellablePrice\(catalog, \{ planSlug, interval, currency: billingCurrency \}\)/)
    expect(route).toMatch(/currency: billingCurrency,/)
  })

  it('checkout: erro ao ler o perfil é fail-closed (500 neutro) e a rejeição usa a resposta neutra única', () => {
    const route = readCode('app/api/billing/checkout/route.ts')
    expect(route).toMatch(/catch \(err\) \{\s*Sentry\.captureException\(err\)\s*return NextResponse\.json\(\{ error: 'Não foi possível verificar a disponibilidade agora/)
    expect(route).toMatch(/getPurchaseIneligibleResponse\(eligibility\.reason\)/)
  })

  it('change-plan: mesma política única, antes de Stripe e de changeOwnPlan', () => {
    const route = readCode('app/api/billing/subscription/change-plan/route.ts')
    const policy = route.indexOf('evaluatePurchaseEligibility({ countryCode, currency: parsed.data.currency })')
    expect(policy).toBeGreaterThan(-1)
    expect(route.indexOf('getStripeClient()')).toBeGreaterThan(policy)
    expect(route.indexOf('changeOwnPlan(adminClient')).toBeGreaterThan(policy)
    expect(route).toMatch(/loadOwnCountryCode\(sessionClient, user\.id\)/)
  })

  it('changeOwnPlan: guarda de plano, depois a política, ANTES de ler a subscription (defesa em profundidade)', () => {
    const lib = readCode('lib/stripe/subscription-management.ts')
    const body = lib.slice(lib.indexOf('export async function changeOwnPlan'))
    const planGuard = body.indexOf('isPlanPurchasable(target.planSlug)')
    const policy = body.indexOf('evaluatePurchaseEligibility({ countryCode, currency: target.currency })')
    const owned = body.indexOf('resolveOwnedEligibleSubscription(supabase, userId)')
    expect(planGuard).toBeGreaterThan(-1)
    expect(policy).toBeGreaterThan(planGuard)
    expect(owned).toBeGreaterThan(policy)
  })

  it('a regra existe UMA vez: as rotas e a lib importam a mesma função, nenhuma repete "=== \'BR\'" nem "\'BRL\'" como regra', () => {
    for (const file of ['app/api/billing/checkout/route.ts', 'app/api/billing/subscription/change-plan/route.ts', 'lib/stripe/subscription-management.ts', 'components/billing/PricingSelector.tsx', 'app/dashboard/upgrade/page.tsx']) {
      const code = readCode(file)
      expect(code, file).not.toMatch(/=== 'BR'|!== 'BR'|=== "BR"/)
    }
    const policy = readCode('lib/billing/purchase-eligibility.ts')
    expect((policy.match(/countryCode !== PURCHASE_ELIGIBLE_COUNTRY/g) ?? []).length).toBe(1)
  })

  it('resolveCurrencyFromCountryCode NÃO foi alterada (páginas não comerciais continuam iguais)', () => {
    const code = readCode('lib/stripe/resolve-currency.ts')
    expect(code).toMatch(/return countryCode === 'BR' \? 'BRL' : 'USD'/)
  })

  it('nenhum preço/produto/moeda novo: USD continua inexistente como opção comercial no código de compra', () => {
    const policy = readCode('lib/billing/purchase-eligibility.ts')
    expect(policy).not.toMatch(/'USD'/)
  })
})

describe('Página de planos — apresentação da elegibilidade (só UX; a barreira é a do servidor)', () => {
  const page = readCode('app/dashboard/upgrade/page.tsx')
  const selector = readCode('components/billing/PricingSelector.tsx')

  it('a página deriva a disponibilidade do país do perfil (falha de leitura = sem elegibilidade) e exibe SEMPRE em BRL', () => {
    expect(page).toMatch(/getPurchaseAvailability\(countryCode\)/)
    expect(page).toMatch(/currency=\{PURCHASE_ELIGIBLE_CURRENCY\}/)
    expect(page).toMatch(/purchaseAvailability=\{purchaseAvailability\}/)
    expect(page).toMatch(/profileResult\.status === 'fulfilled' \?[^\n]*: null/)
    expect(page).not.toMatch(/resolveCurrencyFromCountryCode/)
  })

  it('país nulo: o CTA do Pro vira "Informar país" e só NAVEGA ao perfil (link, sem cobrança)', () => {
    expect(selector).toMatch(/purchaseAvailability === 'country_missing'/)
    expect(selector).toMatch(/label: 'Informar país', disabled: false, href: PROFILE_HREF/)
    expect(selector).toMatch(/const PROFILE_HREF = '\/dashboard\/profile'/)
    expect(selector).toMatch(/\{showCountryMissing && <p[^>]*>\{PURCHASE_COUNTRY_MISSING_MESSAGE\}<\/p>\}/)
  })

  it('fora do Brasil: mensagem "apenas no Brasil por enquanto" e CTA de INTERESSE (plan_interest), nunca Checkout, nunca USD', () => {
    expect(selector).toMatch(/purchaseAvailability === 'country_not_supported'/)
    expect(selector).toMatch(/usePlanInterest\('pro', 'region_unavailable', currency, showRegionUnavailable\)/)
    expect(selector).toMatch(/\{showRegionUnavailable && <p[^>]*>\{PURCHASE_REGION_UNAVAILABLE_MESSAGE\}<\/p>\}/)
    expect(selector).not.toMatch(/USD/)
  })

  it('o checkout só pode ser iniciado quando elegível (ou quando o usuário já é assinante)', () => {
    expect(selector).toMatch(/const canStartCheckout = !isFreeUser \|\| purchaseAvailability === 'eligible'/)
    // as 3 ramas de Free são mutuamente exclusivas e a de checkout é a ÚLTIMA (só alcançada quando elegível)
    const proCta = selector.slice(selector.indexOf('function proCta()'), selector.indexOf('const freeCta'))
    const missing = proCta.indexOf('showCountryMissing')
    const region = proCta.indexOf('showRegionUnavailable')
    const checkout = proCta.indexOf("setCheckoutTarget('pro')")
    expect(missing).toBeGreaterThan(-1)
    expect(region).toBeGreaterThan(missing)
    expect(checkout).toBeGreaterThan(region)
  })

  it('o interesse regional reutiliza o mesmo mecanismo do Premium (hook único) e nunca chama Checkout/Stripe', () => {
    const hook = selector.slice(selector.indexOf('function usePlanInterest'), selector.indexOf('export function PricingSelector'))
    expect(hook).not.toMatch(/fetch\(|\/api\/billing|getStripeClient|window\.location/)
    expect((selector.match(/function usePlanInterest/g) ?? []).length).toBe(1)
  })

  it('PlanCard suporta o CTA de navegação (link) sem virar ação comercial', () => {
    const card = readCode('components/billing/PlanCard.tsx')
    expect(card).toMatch(/ctaHref && !isCurrentPlan/)
    expect(card).toMatch(/<Link/)
  })

  it('Premium continua "Em breve", sem checkout e sem regra regional própria', () => {
    const premiumCard = selector.slice(selector.indexOf('name={PLAN_NAMES.premium}'))
    expect(premiumCard.slice(0, premiumCard.indexOf('/>'))).toMatch(/comingSoon/)
    expect(selector).not.toMatch(/setCheckoutTarget\('premium'\)/)
  })
})

describe('Diálogo de upgrade — mensagens do servidor', () => {
  const dialog = readCode('components/billing/UpgradeToProDialog.tsx')

  it('mostra a mensagem devolvida pelo servidor e, só para país ausente, o atalho ao perfil (sem alterar o contrato do checkout)', () => {
    expect(dialog).toMatch(/setError\(body\?\.error \?\? 'Não foi possível iniciar o upgrade agora/)
    expect(dialog).toMatch(/setErrorCode\(body\?\.code \?\? null\)/)
    expect(dialog).toMatch(/errorCode === 'country_missing'/)
    expect(dialog).toMatch(/href="\/dashboard\/profile"/)
    expect(dialog).toMatch(/JSON\.stringify\(\{ planSlug: targetPlanSlug, interval, currency, analyticsConsent \}\)/)
  })
})

describe('Dashboard — retorno do checkout e pagamento pendente', () => {
  const page = readCode('app/dashboard/page.tsx')

  it('é um Server Component que lê searchParams e resolve o retorno ANTES de ler plano/entitlements', () => {
    expect(page).not.toMatch(/^'use client'/m)
    expect(page).toMatch(/searchParams: Promise</)
    expect(page).toMatch(/await searchParams/)
    const resolve = page.indexOf('await resolveCheckoutNoticeInput(user.id, checkoutParam, sessionIdParam)')
    const promiseAll = page.indexOf('await Promise.all([')
    expect(resolve).toBeGreaterThan(-1)
    expect(promiseAll).toBeGreaterThan(resolve)
  })

  it('o usuário vem SEMPRE da sessão autenticada (user.id) — nunca da URL', () => {
    expect(page).toMatch(/resolveCheckoutNoticeInput\(user\.id,/)
    expect(page).toMatch(/userId,\s*\n\s*sessionId: sessionIdParam/)
    expect(page).not.toMatch(/queryParams\.(user|plan|price|currency)/)
  })

  it('cancel só informa: retorna ANTES de qualquer ambiente/Stripe/banco; formato do session_id é validado antes do Stripe', () => {
    const fn = page.slice(page.indexOf('async function resolveCheckoutNoticeInput'), page.indexOf('export default async function DashboardPage'))
    const cancel = fn.indexOf("checkoutParam === 'cancel'")
    const pattern = fn.indexOf('CHECKOUT_SESSION_ID_PATTERN.test(sessionIdParam)')
    const env = fn.indexOf('assertBillingEnvironment(')
    const stripe = fn.indexOf('getStripeClient()')
    expect(cancel).toBeGreaterThan(-1)
    expect(pattern).toBeGreaterThan(cancel)
    expect(env).toBeGreaterThan(pattern)
    expect(stripe).toBeGreaterThan(env)
    expect(fn.slice(0, env)).not.toMatch(/getSupabaseAdminClient|\.from\(|\.rpc\(/)
  })

  it('"success" na URL nunca altera o plano exibido: planSlug continua vindo só de get_effective_plan', () => {
    expect(page).toMatch(/const planSlug = \(effectivePlanResult\.data as \{ plan_slug: string \} \| null\)\?\.plan_slug \?\? 'free'/)
    expect(page).not.toMatch(/checkoutParam === 'success'[^\n]*planSlug/)
  })

  it('o aviso de pagamento pendente usa o status REAL da subscription (RPC self-scoped) e só a regra pura isPaymentPendingStatus', () => {
    expect(page).toMatch(/supabase\.rpc\('get_my_subscription'\)\.maybeSingle\(\)/)
    expect(page).toMatch(/isPaymentPendingStatus\(\(ownSubscriptionResult\.data as \{ status: string \} \| null\)\?\.status\)/)
    expect(page).toMatch(/<BillingNotices items=\{billingNoticeItems\} \/>/)
  })

  it('o botão "Atualizar" só volta para a MESMA URL de retorno (session_id codificado) — nenhum estado novo', () => {
    expect(page).toMatch(/checkoutNoticeInput === 'pending' && sessionIdParam/)
    expect(page).toMatch(/encodeURIComponent\(sessionIdParam\)/)
  })

  it('o componente de avisos é apresentacional (sem estado, sem fetch, sem Stripe, sem cliente)', () => {
    const notices = readCode('app/dashboard/BillingNotices.tsx')
    expect(notices).not.toMatch(/'use client'|useState|useEffect|fetch\(|stripe|getSupabase/i)
  })

  it('política de acesso intacta: nenhum arquivo de banco/effective_plans foi tocado por este bloco', () => {
    const effectivePlans = readFileSync(path.join(ROOT, 'supabase/migrations/20260818131512_create_effective_plans_source.sql'), 'utf8')
    expect(effectivePlans).toMatch(/where s\.status in \('trialing', 'active', 'past_due'\)/)
  })
})
