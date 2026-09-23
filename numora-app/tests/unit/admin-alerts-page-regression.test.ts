/**
 * tests/unit/admin-alerts-page-regression.test.ts
 * Etapa "Admin Alerts V1".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de tests/unit/admin-transactions-page-regression.test.ts
 * e outras suítes desta base de código): sem jsdom/testing-library
 * (`environment: 'node'`), não é possível renderizar `app/admin/alerts/page.tsx`
 * nem clicar em nada aqui. As regras puras (janela de 7 dias, feedback
 * crítico) já estão cobertas por comportamento real em
 * tests/unit/admin-alerts-repository.test.ts — o que falta cobrir aqui é
 * exclusivamente a ORQUESTRAÇÃO da página: duas seções independentes,
 * ausência total de mutação, ausência de KPI/severidade/score inventados.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE_FILE_PATH = path.resolve(__dirname, '../../app/admin/alerts/page.tsx')

function readPageSource(): string {
  return readFileSync(PAGE_FILE_PATH, 'utf8')
}

/** Código executável, sem o comentário de cabeçalho do arquivo (que cita `.insert(`/`FeedbackDetailModal`/etc. em prosa, explicando decisões de design) — evita falso-positivo de "prosa combinando com regex de código real". */
function readPageCode(): string {
  const source = readPageSource()
  const codeStart = source.indexOf("'use client'")
  return source.slice(codeStart)
}

describe('app/admin/alerts/page.tsx — V1 read-only (Admin Alerts)', () => {
  it('o arquivo da página existe e é legível (pré-condição do teste)', () => {
    expect(() => readPageSource()).not.toThrow()
  })

  it('não usa mais o AdminComingSoon — a página tem implementação real (busca por USO real, não pela menção em prosa no cabeçalho do arquivo)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/import\s*\{?\s*AdminComingSoon/)
    expect(source).not.toMatch(/<AdminComingSoon/)
  })

  it('existem exatamente duas seções independentes — "Cortesias expirando" e "Feedback crítico não resolvido"', () => {
    const source = readPageSource()
    expect(source).toMatch(/Cortesias expirando/)
    expect(source).toMatch(/Feedback crítico não resolvido/)
  })

  it('cada seção carrega os próprios dados de forma independente (dois useEffect/load separados, nunca uma lista unificada)', () => {
    const source = readPageSource()
    expect(source).toMatch(/function ExpiringBenefitGrantsSection/)
    expect(source).toMatch(/function CriticalFeedbackSection/)
    // Nenhuma estrutura de dado combinando os dois tipos numa lista única.
    expect(source).not.toMatch(/combinedAlerts|allAlerts|unifiedAlerts/i)
  })

  it('cortesias expirando usa alertsRepository.listExpiringBenefitGrants() (nunca uma query genérica de "todas as cortesias")', () => {
    const source = readPageSource()
    expect(source).toMatch(/alertsRepository\.listExpiringBenefitGrants\(\)/)
  })

  it('feedback crítico reutiliza feedbackAdminRepository.list() já existente, filtrando com isCriticalUnresolvedFeedback (nunca duplica a query/embed de /admin/feedback)', () => {
    const source = readPageSource()
    expect(source).toMatch(/feedbackAdminRepository\.list\(\)/)
    expect(source).toMatch(/\.filter\(isCriticalUnresolvedFeedback\)/)
    expect(source).not.toMatch(/\.from\(['"]feedbacks['"]\)/)
  })

  it('READ-ONLY estrito: nenhuma escrita/mutação em nenhuma tabela, em nenhuma das duas seções', () => {
    const code = readPageCode()
    expect(code).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
    expect(code).not.toMatch(/updateAdmin\(|grantCourtesy\(|revokeActiveCourtesy\(/)
  })

  it('nenhuma checagem de role própria — a barreira real é a RLS mais o app/admin/layout.tsx compartilhado (requireAdmin())', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/requireAdmin\(/)
    expect(source).not.toMatch(/is_platform_admin/)
  })

  it('nenhuma chamada Supabase direta na página — as queries ficam isoladas nos repositories', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/getSupabase\w*Client\(/)
    expect(source).not.toMatch(/\.from\(['"]benefit_grants['"]\)/)
  })

  it('nenhum Stripe/Sentry/endpoint externo é chamado', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/getStripeClient\(/)
    expect(source).not.toMatch(/from ['"]stripe['"]/)
    expect(source).not.toMatch(/sentry\.io|Sentry\.captureException|await fetch\(/i)
  })

  it('nenhum KPI de "alertas ativos", filtro de severidade, score ou classificação inventada', () => {
    const code = readPageCode()
    expect(code).not.toMatch(/alertas ativos/i)
    expect(code).not.toMatch(/severity|severidade/i)
    expect(code).not.toMatch(/\bscore\b/i)
    expect(code).not.toMatch(/StatCard/)
  })

  it('a "ação" de cada seção é um link de navegação (nunca reabre o FeedbackDetailModal/GrantCourtesyModal com escrita habilitada)', () => {
    const code = readPageCode()
    expect(code).not.toMatch(/FeedbackDetailModal|GrantCourtesyModal/)
    expect(code).toMatch(/<Link href="\/admin\/members"/)
    expect(code).toMatch(/<Link href="\/admin\/feedback"/)
  })

  it('nenhum "user_id" cru é exibido no JSX — só userName/userEmail já mapeados pelos repositories', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/\{grant\.userId\}/)
    expect(source).not.toMatch(/\{feedback\.userId\}/)
  })

  it('empty states honestos: "Nenhuma cortesia expira nos próximos 7 dias." e "Nenhum feedback crítico pendente."', () => {
    const source = readPageSource()
    expect(source).toMatch(/Nenhuma cortesia expira nos próximos 7 dias\./)
    expect(source).toMatch(/Nenhum feedback crítico pendente\./)
  })

  it('cada seção trata loading, erro e vazio de forma independente (isLoading/error próprios, ErrorState/EmptyState em cada uma)', () => {
    const source = readPageSource()
    const errorStateCount = (source.match(/<ErrorState/g) ?? []).length
    const emptyStateCount = (source.match(/<EmptyState/g) ?? []).length
    expect(errorStateCount).toBe(2)
    expect(emptyStateCount).toBe(2)
  })

  it('nenhuma dependência nova é importada (só módulos já usados no projeto)', () => {
    const source = readPageSource()
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    for (const specifier of imports) {
      expect(specifier.startsWith('@/') || specifier === 'react' || specifier === 'next/link' || specifier === 'lucide-react').toBe(true)
    }
  })

  it('nenhum dado fictício/hardcoded é exibido — nenhum e-mail/nome/id literal no JSX', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/@example\.com/)
    expect(source).not.toMatch(/grant-[0-9]|feedback-[0-9]/)
  })
})
