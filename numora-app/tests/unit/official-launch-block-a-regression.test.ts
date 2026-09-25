/**
 * tests/unit/official-launch-block-a-regression.test.ts
 * Etapa "Official Launch Foundation — Bloco A".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts
 * e outras suítes desta base): sem jsdom/testing-library (`environment: 'node'`)
 * não é possível renderizar `PricingSelector`/`UpgradeToProDialog`/
 * `LabelGeneratorModal` nem clicar em nada aqui. A REGRA de negócio (Premium
 * não contratável) está provada com comportamento real em
 * tests/unit/premium-purchase-guard.test.ts — este arquivo cobre só a
 * ORQUESTRAÇÃO da UI, por inspeção de código-fonte. Por isso as buscas rodam
 * sobre o CÓDIGO (comentários removidos): os cabeçalhos dos arquivos citam,
 * em prosa, exatamente os textos proibidos ("Durante o Beta", `mailto:`…) ao
 * explicar decisões — o que geraria falso-positivo.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { FREE_BENEFITS, PREMIUM_BENEFITS, PRO_BENEFITS } from '@/lib/billing/plan-benefits'

const ROOT = path.resolve(__dirname, '../..')

function readCode(relativePath: string): string {
  const source = readFileSync(path.join(ROOT, relativePath), 'utf8')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function sliceBetween(code: string, startMarker: string, endMarker: string): string {
  const start = code.indexOf(startMarker)
  expect(start, `marcador inicial ausente: ${startMarker}`).toBeGreaterThan(-1)
  const end = code.indexOf(endMarker, start)
  expect(end, `marcador final ausente: ${endMarker}`).toBeGreaterThan(start)
  return code.slice(start, end)
}

describe('Pro — benefícios comerciais completos', () => {
  it('lista Coleção ilimitada, Dashboard avançado, Numora Labels, Exportação CSV e Exportação XLSX', () => {
    expect([...PRO_BENEFITS]).toEqual(['Coleção ilimitada', 'Dashboard avançado', 'Numora Labels', 'Exportação CSV', 'Exportação XLSX'])
  })

  it('não promete Map, Insights, IA nem Intelligence (nada disso existe hoje)', () => {
    const joined = PRO_BENEFITS.join(' | ')
    expect(joined).not.toMatch(/map|insights|intelligence|\bia\b|inteligência/i)
  })

  it('Free lista só o que existe (limite de 50 e Passport público)', () => {
    expect([...FREE_BENEFITS]).toEqual(['Até 50 moedas ativas na coleção', 'Passport público'])
  })

  it('Premium: recursos planejados aparecem SEMPRE marcados "(em breve)" — nunca como existentes', () => {
    const planned = PREMIUM_BENEFITS.filter((benefit) => /insights|map/i.test(benefit))
    expect(planned.length).toBe(2)
    for (const benefit of planned) {
      expect(benefit).toMatch(/\(em breve\)/)
    }
    expect([...PREMIUM_BENEFITS]).toContain('Tudo do Pro')
  })

  it('PricingSelector e UpgradeToProDialog usam a MESMA fonte de benefícios (nenhuma lista paralela)', () => {
    const selector = readCode('components/billing/PricingSelector.tsx')
    const dialog = readCode('components/billing/UpgradeToProDialog.tsx')
    expect(selector).toMatch(/from '@\/lib\/billing\/plan-benefits'/)
    expect(dialog).toMatch(/from '@\/lib\/billing\/plan-benefits'/)
    expect(selector).not.toMatch(/Exportação CSV/)
    expect(dialog).not.toMatch(/Exportação CSV/)
  })
})

describe('PricingSelector — Premium "Em breve", sem checkout', () => {
  const code = readCode('components/billing/PricingSelector.tsx')
  const premiumCard = sliceBetween(code, 'name={PLAN_NAMES.premium}', '/>')

  it('o card do Premium é marcado como comingSoon e usa o CTA de interesse', () => {
    expect(premiumCard).toMatch(/comingSoon/)
    expect(premiumCard).toMatch(/onCtaClick=\{handleRegisterPremiumInterest\}/)
    expect(premiumCard).toMatch(/ctaLabel=\{premiumCtaLabel\}/)
  })

  it('o CTA do Premium é "Quero ser avisado" e, depois de registrado, "Você está na lista de interesse"', () => {
    expect(code).toMatch(/'Quero ser avisado'/)
    expect(code).toMatch(/'Você está na lista de interesse'/)
  })

  it('o card do Premium NUNCA usa "Fazer upgrade", checkout ou troca de plano', () => {
    expect(premiumCard).not.toMatch(/Fazer upgrade/)
    expect(premiumCard).not.toMatch(/setCheckoutTarget/)
    expect(premiumCard).not.toMatch(/setChangeAction/)
    expect(code).not.toMatch(/setCheckoutTarget\('premium'\)/)
    expect(code).not.toMatch(/targetPlanSlug: 'premium'/)
    expect(code).not.toMatch(/ctaFor\(/)
  })

  it('o CTA do Premium registra interesse em plan_slug = "premium" via plan_interest', () => {
    expect(code).toMatch(/planInterestRepository\.register\(\{\s*planSlug:\s*'premium',\s*source:\s*'pricing_page'\s*\}\)/)
  })

  it('handleRegisterPremiumInterest nunca chama Checkout, Stripe nem redireciona', () => {
    const handler = sliceBetween(code, 'async function handleRegisterPremiumInterest', 'async function confirmChange')
    expect(handler).not.toMatch(/fetch\(/)
    expect(handler).not.toMatch(/\/api\/billing/)
    expect(handler).not.toMatch(/getStripeClient\(/)
    expect(handler).not.toMatch(/window\.location/)
  })

  it('o evento de interesse só é disparado DEPOIS do register() confirmado e nunca no catch de falha', () => {
    const handler = sliceBetween(code, 'async function handleRegisterPremiumInterest', 'async function confirmChange')
    const registerIndex = handler.indexOf('planInterestRepository.register(')
    const trackIndex = handler.indexOf('trackUpgradeInterestRegistered(')
    expect(trackIndex).toBeGreaterThan(registerIndex)

    const outerCatchStart = handler.indexOf('} catch (err) {', trackIndex + 1)
    const finallyStart = handler.indexOf('} finally {')
    const outerCatchBody = handler.slice(outerCatchStart, finallyStart)
    expect(outerCatchBody).not.toMatch(/trackUpgradeInterestRegistered\(/)
  })

  it('a ÚNICA rota de Checkout é o UpgradeToProDialog do Pro; a única troca de plano é o downgrade para Pro', () => {
    expect(code).toMatch(/useState<PurchasablePlanSlug \| null>\(null\)/)
    expect(code).toMatch(/kind: 'change-plan'; targetPlanSlug: PurchasablePlanSlug/)
    expect(code).toMatch(/setChangeAction\(\{ kind: 'change-plan', targetPlanSlug: 'pro' \}\)/)
  })

  it('preço exibido vem do catálogo mesmo com active=false; "Grátis" só existe no card Free', () => {
    expect(code).toMatch(/priceLabel=\{proDisplayPrice \?/)
    expect(code).toMatch(/priceLabel=\{premiumDisplayPrice \?/)
    expect((code.match(/priceLabel=\{null\}/g) ?? []).length).toBe(1)
    // a habilitação de compra do Pro continua exigindo preço ATIVO
    expect(code).toMatch(/ctaDisabled=\{proCtaState\.disabled \|\| !proActivePrice\}/)
  })

  it('nenhum segredo/Stripe server-side no client component', () => {
    expect(code).not.toMatch(/getStripeClient|STRIPE_SECRET|service_role|from 'stripe'/)
  })
})

describe('PlanCard — badge "Em breve"', () => {
  it('mostra o badge "Em breve" quando comingSoon', () => {
    const code = readCode('components/billing/PlanCard.tsx')
    expect(code).toMatch(/comingSoon && <Badge tone="neutral">Em breve<\/Badge>/)
  })
})

describe('UpgradeToProDialog — conteúdo dinâmico por plano', () => {
  const code = readCode('components/billing/UpgradeToProDialog.tsx')

  it('não existe mais nenhuma copy de "Beta" (nem "Durante o Beta") no componente', () => {
    expect(code).not.toMatch(/Durante o Beta/)
    expect(code).not.toMatch(/\bBeta\b/)
  })

  it('Pro: título "Desbloqueie o plano Pro" e CTA "Fazer upgrade para Pro"', () => {
    expect(code).toMatch(/const DEFAULT_TITLE = 'Desbloqueie o plano Pro'/)
    expect(code).toMatch(/const CHECKOUT_CTA_LABEL = 'Fazer upgrade para Pro'/)
    expect(code).toMatch(/\{CHECKOUT_CTA_LABEL\}/)
  })

  it('Premium: estado "Premium em breve" sem Checkout — o botão de Checkout só existe quando NÃO é "em breve"', () => {
    expect(code).toMatch(/const COMING_SOON_TITLE = 'Premium em breve'/)
    expect(code).toMatch(/title=\{isComingSoon \? COMING_SOON_TITLE : \(title \?\? DEFAULT_TITLE\)\}/)
    expect(code).toMatch(/\{!isComingSoon && \(\s*<Button type="button" onClick=\{handleUpgrade\}/)
  })

  it('handleUpgrade recusa plano não contratável ANTES de qualquer fetch', () => {
    const upgradeHandler = code.slice(code.indexOf('async function handleUpgrade'))
    const guardIndex = upgradeHandler.indexOf('isPlanPurchasable(targetPlanSlug)')
    const fetchIndex = upgradeHandler.indexOf("fetch('/api/billing/checkout'")
    expect(guardIndex).toBeGreaterThan(-1)
    expect(fetchIndex).toBeGreaterThan(guardIndex)
  })

  it('o bloco "Premium em breve" não promete nenhum recurso (nada de Map/Insights/IA)', () => {
    const comingSoonBlock = sliceBetween(code, '{isComingSoon ? (', ') : (')
    expect(comingSoonBlock).not.toMatch(/map|insights|intelligence|\bia\b/i)
    expect(comingSoonBlock).toMatch(/ainda não está disponível para contratação/)
  })

  it('o CTA "Quero ser avisado" continua registrando o plano APRESENTADO (targetPlanSlug), nunca um plano fixo', () => {
    expect(code).toMatch(/planInterestRepository\.register\(\{ planSlug: targetPlanSlug, source: trigger \}\)/)
  })
})

describe('Labels — paywall padronizado (sem mailto comercial)', () => {
  const code = readCode('features/labels/components/LabelGeneratorModal.tsx')

  it('não usa mailto: como CTA comercial', () => {
    expect(code).not.toMatch(/mailto:/)
    expect(code).not.toMatch(/UPGRADE_MAILTO/)
    expect(code).not.toMatch(/window\.location\.href\s*=/)
  })

  it('o CTA do card bloqueado abre o UpgradeToProDialog', () => {
    const blocked = sliceBetween(code, "state === 'blocked' &&", "state === 'ready' &&")
    expect(blocked).toMatch(/onClick=\{\(\) => setIsUpgradeDialogOpen\(true\)\}/)
    expect(blocked).toMatch(/Fazer upgrade/)
  })

  it('o diálogo é o UpgradeToProDialog com trigger="labels" e targetPlanSlug="pro"', () => {
    expect(code).toMatch(/import \{ UpgradeToProDialog \} from '@\/components\/billing\/UpgradeToProDialog'/)
    expect(code).toMatch(/<UpgradeToProDialog[\s\S]*trigger="labels"[\s\S]*targetPlanSlug="pro"[\s\S]*\/>/)
  })

  it('a moeda vem do country_code do perfil (fail-safe USD até carregar) e o feature_locked continua sendo disparado', () => {
    expect(code).toMatch(/useState<PriceCurrency>\('USD'\)/)
    expect(code).toMatch(/resolveCurrencyFromCountryCode\(profile\.countryCode\)/)
    expect(code).toMatch(/trackFeatureLocked\(/)
  })

  it('os mailtos LEGÍTIMOS de suporte foram preservados (Footer e Termos)', () => {
    expect(readCode('components/layout/Footer.tsx')).toMatch(/mailto:/)
    expect(readFileSync(path.join(ROOT, 'app/terms/page.tsx'), 'utf8')).toMatch(/mailto:suporte\.numora@gmail\.com/)
  })
})

describe('Página /dashboard/upgrade — acessível pelo dashboard', () => {
  it('a Sidebar tem o item "Planos" apontando para /dashboard/upgrade', () => {
    const sidebar = readCode('components/ui/Sidebar.tsx')
    expect(sidebar).toMatch(/\{ href: '\/dashboard\/upgrade', label: 'Planos', icon: Sparkles \}/)
  })

  it('o item de Planos está na navegação PRINCIPAL (visível a todo usuário), nunca só no bloco de administração', () => {
    const sidebar = readCode('components/ui/Sidebar.tsx')
    const mainNav = sliceBetween(sidebar, 'const MAIN_NAV', 'const ADMIN_NAV_ITEM')
    expect(mainNav).toMatch(/\/dashboard\/upgrade/)
  })

  it('a página lê o catálogo REAL, exige sessão e renderiza o PricingSelector', () => {
    const page = readCode('app/dashboard/upgrade/page.tsx')
    expect(page).toMatch(/getCommercialPlanPricesCatalog\(supabase\)/)
    expect(page).toMatch(/redirect\('\/login'\)/)
    expect(page).toMatch(/<PricingSelector/)
  })
})

describe('Perfil — Pro → Premium não é oferecido', () => {
  it('o botão "Fazer upgrade para Premium" só aparece se Premium for contratável (hoje nunca)', () => {
    const profile = readCode('app/dashboard/profile/page.tsx')
    const buttonIndex = profile.search(/Fazer upgrade para Premium\s*<\/Button>/)
    expect(buttonIndex).toBeGreaterThan(-1)
    const before = profile.slice(Math.max(0, buttonIndex - 700), buttonIndex)
    expect(before).toMatch(/isPlanPurchasable\('premium'\)/)
  })

  it('o downgrade Premium → Pro (destino Pro) continua oferecido', () => {
    const profile = readCode('app/dashboard/profile/page.tsx')
    expect(profile).toMatch(/Fazer downgrade para Pro/)
  })
})

describe('Servidor — a guarda vem antes de qualquer acesso a Stripe/catálogo', () => {
  it('checkout: isPlanPurchasable antes de getStripeClient() e do catálogo', () => {
    const route = readCode('app/api/billing/checkout/route.ts')
    const guard = route.indexOf('isPlanPurchasable(planSlug)')
    expect(guard).toBeGreaterThan(-1)
    expect(route.indexOf('getStripeClient()')).toBeGreaterThan(guard)
    expect(route.indexOf('getCommercialPlanPricesCatalog(sessionClient)')).toBeGreaterThan(guard)
    expect(route.indexOf('getOrCreateBillingCustomer(')).toBeGreaterThan(guard)
  })

  it('change-plan: isPlanPurchasable antes de getStripeClient() e de changeOwnPlan()', () => {
    const route = readCode('app/api/billing/subscription/change-plan/route.ts')
    const guard = route.indexOf('isPlanPurchasable(parsed.data.planSlug)')
    expect(guard).toBeGreaterThan(-1)
    expect(route.indexOf('getStripeClient()')).toBeGreaterThan(guard)
    expect(route.indexOf('changeOwnPlan(adminClient')).toBeGreaterThan(guard)
  })

  it('changeOwnPlan: a guarda é a PRIMEIRA instrução do corpo da função', () => {
    const lib = readCode('lib/stripe/subscription-management.ts')
    const fnStart = lib.indexOf('export async function changeOwnPlan')
    const body = lib.slice(fnStart)
    expect(body.indexOf('isPlanPurchasable(target.planSlug)')).toBeGreaterThan(-1)
    expect(body.indexOf('isPlanPurchasable(target.planSlug)')).toBeLessThan(body.indexOf('resolveOwnedEligibleSubscription(supabase, userId)'))
  })

  it('nenhuma migration nova foi criada por este bloco (banco inalterado)', () => {
    // O Bloco A não altera schema/RLS: a última migration versionada continua sendo a de dashboard_advanced.
    const migrations = readFileSync(path.join(ROOT, 'supabase/migrations/20260910170754_dashboard_advanced_entitlement.sql'), 'utf8')
    expect(migrations).toMatch(/dashboard_advanced/)
  })
})
