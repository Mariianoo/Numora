/**
 * tests/unit/admin-subscriptions-page-regression.test.ts
 * Etapa "Admin Subscriptions V1".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de outras suítes desta base de código — ver
 * tests/unit/analysis-account-page-regression.test.ts): sem
 * jsdom/testing-library (`environment: 'node'`), não é possível renderizar
 * `app/admin/subscriptions/page.tsx` nem clicar em nada aqui. Este arquivo
 * cobre, por inspeção de fonte, que a página é genuinamente READ-ONLY
 * (nenhuma escrita/ação/Stripe SDK) e que nunca mistura cortesia/Conta de
 * Análise com a listagem de assinaturas.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE_FILE_PATH = path.resolve(__dirname, '../../app/admin/subscriptions/page.tsx')

function readPageSource(): string {
  return readFileSync(PAGE_FILE_PATH, 'utf8')
}

describe('app/admin/subscriptions/page.tsx — V1 read-only (Admin Subscriptions)', () => {
  it('o arquivo da página existe e é legível (pré-condição do teste)', () => {
    expect(() => readPageSource()).not.toThrow()
  })

  it('não usa mais o AdminComingSoon — a página tem implementação real (busca por USO real, não pela menção em prosa no cabeçalho do arquivo)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/import\s*\{?\s*AdminComingSoon/)
    expect(source).not.toMatch(/<AdminComingSoon/)
  })

  it('carrega dados via o repository de assinaturas — listSubscriptions() e getSummary()', () => {
    const source = readPageSource()
    expect(source).toMatch(/subscriptionsRepository\.listSubscriptions\(/)
    expect(source).toMatch(/subscriptionsRepository\s*\.getSummary\(\)/)
  })

  it('READ-ONLY: nenhuma escrita/mutação — sem insert/update/delete, sem RPC de escrita conhecida', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
    expect(source).not.toMatch(/cancel_subscription|reactivate_subscription|change_plan|admin_cancel|admin_change_plan/i)
  })

  it('nenhuma chamada Stripe direta (SDK/API) — só links de navegação para o Dashboard', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/getStripeClient\(/)
    expect(source).not.toMatch(/from ['"]stripe['"]/)
    expect(source).not.toMatch(/await fetch\(|=\s*fetch\(/)
    expect(source).not.toMatch(/\/api\/billing/)
  })

  it('nenhuma chamada Supabase direta fora do repository (getSupabaseBrowserClient/getSupabaseServerClient)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/getSupabase\w*Client\(/)
  })

  it('nunca menciona benefit_grants/internal_test/cortesia/Conta de Análise como FONTE de dado desta tela (só no comentário explicando o isolamento)', () => {
    const source = readPageSource()
    // A única ocorrência esperada é a prosa do cabeçalho do arquivo
    // explicando a separação — nunca uma chamada real a essas tabelas/RPCs.
    expect(source).not.toMatch(/\.from\(['"]benefit_grants['"]\)/)
    expect(source).not.toMatch(/\.from\(['"]internal_test_accounts['"]\)/)
    expect(source).not.toMatch(/switch_analysis_account_plan|grantCourtesy|revokeActiveCourtesy/)
  })

  it('não existe coluna "Origem" na tabela (decisão explícita da auditoria — toda linha já é Stripe por construção)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/>Origem</)
  })

  it('os links do Stripe Dashboard usam o ID REAL (stripeCustomerId/stripeSubscriptionId) no href, nunca o mascarado', () => {
    const source = readPageSource()
    expect(source).toMatch(/href=\{buildStripeCustomerDashboardUrl\(row\.stripeCustomerId\)\}/)
    expect(source).toMatch(/href=\{buildStripeSubscriptionDashboardUrl\(row\.stripeSubscriptionId\)\}/)
    // O texto visível é sempre a versão mascarada.
    expect(source).toMatch(/\{row\.stripeCustomerIdMasked\}/)
    expect(source).toMatch(/\{row\.stripeSubscriptionIdMasked\}/)
  })

  it('os links do Stripe Dashboard abrem em nova aba com rel="noopener noreferrer"', () => {
    const source = readPageSource()
    const linkBlocks = source.match(/<a\s+href=\{buildStripe\w+DashboardUrl[\s\S]*?<\/a>/g) ?? []
    expect(linkBlocks.length).toBeGreaterThanOrEqual(2)
    for (const block of linkBlocks) {
      expect(block).toMatch(/target="_blank"/)
      expect(block).toMatch(/rel="noopener noreferrer"/)
    }
  })

  it('paginação é server-side (offset calculado a partir de page * PAGE_SIZE, enviado à RPC via repository)', () => {
    const source = readPageSource()
    expect(source).toMatch(/offset: page \* PAGE_SIZE/)
    expect(source).not.toMatch(/\.slice\(page \*/)
  })

  it('nenhuma dependência nova é importada (só módulos já usados no projeto)', () => {
    const source = readPageSource()
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    for (const specifier of imports) {
      expect(specifier.startsWith('@/') || specifier === 'react' || specifier === 'lucide-react').toBe(true)
    }
  })

  it('estados obrigatórios estão presentes: loading, erro, vazio (com e sem filtro), dados, paginação', () => {
    const source = readPageSource()
    expect(source).toMatch(/isLoading/)
    expect(source).toMatch(/<ErrorState/)
    expect(source).toMatch(/<EmptyState/)
    expect(source).toMatch(/hasActiveFilters/)
  })

  it('nenhum dado fictício/hardcoded é exibido — não há subscription/customer id literal no JSX', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/cus_[0-9a-zA-Z]{6,}/)
    expect(source).not.toMatch(/sub_[0-9a-zA-Z]{6,}/)
  })
})
