/**
 * tests/unit/admin-transactions-page-regression.test.ts
 * Etapa "Admin Transactions V1".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de tests/unit/admin-subscriptions-page-regression.test.ts
 * e outras suítes desta base de código): sem jsdom/testing-library
 * (`environment: 'node'`), não é possível renderizar
 * `app/admin/transactions/page.tsx` nem clicar em nada aqui. Este arquivo
 * cobre, por inspeção de fonte, que a página é genuinamente READ-ONLY
 * (nenhuma escrita/ação/Stripe SDK), que nunca expõe `user_id` cru, e que
 * usa exclusivamente a fonte `billing_transactions` via o repository.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE_FILE_PATH = path.resolve(__dirname, '../../app/admin/transactions/page.tsx')

function readPageSource(): string {
  return readFileSync(PAGE_FILE_PATH, 'utf8')
}

describe('app/admin/transactions/page.tsx — V1 read-only (Admin Transactions)', () => {
  it('o arquivo da página existe e é legível (pré-condição do teste)', () => {
    expect(() => readPageSource()).not.toThrow()
  })

  it('não usa mais o AdminComingSoon — a página tem implementação real (busca por USO real, não pela menção em prosa no cabeçalho do arquivo)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/import\s*\{?\s*AdminComingSoon/)
    expect(source).not.toMatch(/<AdminComingSoon/)
  })

  it('carrega dados via o repository de transações — listTransactions()', () => {
    const source = readPageSource()
    expect(source).toMatch(/transactionsRepository\.listTransactions\(/)
  })

  it('READ-ONLY: nenhuma escrita/mutação — sem insert/update/delete, sem RPC de escrita conhecida', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
    expect(source).not.toMatch(/refund_transaction|admin_refund|admin_cancel|admin_change_plan/i)
  })

  it('nenhuma chamada Stripe direta (SDK/API) — só links de navegação para o Dashboard', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/getStripeClient\(/)
    expect(source).not.toMatch(/from ['"]stripe['"]/)
    expect(source).not.toMatch(/await fetch\(|=\s*fetch\(/)
    expect(source).not.toMatch(/\/api\/billing/)
  })

  it('nenhuma chamada Supabase direta na página — a query fica isolada no repository (getSupabaseBrowserClient/getSupabaseServerClient)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/getSupabase\w*Client\(/)
    expect(source).not.toMatch(/\.from\(['"]billing_transactions['"]\)/)
  })

  it('nunca menciona benefit_grants/internal_test_accounts como FONTE de dado desta tela (fonte única é billing_transactions)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/\.from\(['"]benefit_grants['"]\)/)
    expect(source).not.toMatch(/\.from\(['"]internal_test_accounts['"]\)/)
    expect(source).not.toMatch(/switch_analysis_account_plan|grantCourtesy|revokeActiveCourtesy/)
  })

  it('nenhum `user_id` cru é exibido no JSX — só userName/userEmail já mapeados pelo repository', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/\{row\.userId\}/)
    expect(source).not.toMatch(/>row\.userId</)
  })

  it('não existe coluna "Origem" na tabela, e nenhum valor monetário é hardcoded fora de formatAmount()/formatPrice()', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/>Origem</)
    // Único uso aceitável de "R$"/número monetário literal é dentro do JSDoc do
    // cabeçalho explicando a regra — nunca dentro do corpo da função do componente.
    const componentStart = source.indexOf('export default function AdminTransactionsPage')
    const componentBody = source.slice(componentStart)
    expect(componentBody).not.toMatch(/R\$\s?0,00/)
  })

  it('os links do Stripe Dashboard usam o ID REAL (stripeInvoiceId/stripePaymentIntentId/stripeSubscriptionId) no href, nunca o mascarado', () => {
    const source = readPageSource()
    expect(source).toMatch(/href=\{buildStripeInvoiceDashboardUrl\(row\.stripeInvoiceId\)\}/)
    expect(source).toMatch(/href=\{buildStripePaymentIntentDashboardUrl\(row\.stripePaymentIntentId\)\}/)
    expect(source).toMatch(/href=\{buildStripeSubscriptionDashboardUrl\(row\.stripeSubscriptionId\)\}/)
    // O texto visível é sempre a versão mascarada.
    expect(source).toMatch(/\{row\.stripeInvoiceIdMasked\}/)
    expect(source).toMatch(/\{row\.stripePaymentIntentIdMasked\}/)
    expect(source).toMatch(/\{row\.stripeSubscriptionIdMasked\}/)
  })

  it('os links do Stripe Dashboard abrem em nova aba com rel="noopener noreferrer"', () => {
    const source = readPageSource()
    const linkBlocks = source.match(/<a\s+href=\{buildStripe\w+DashboardUrl[\s\S]*?<\/a>/g) ?? []
    expect(linkBlocks.length).toBeGreaterThanOrEqual(3)
    for (const block of linkBlocks) {
      expect(block).toMatch(/target="_blank"/)
      expect(block).toMatch(/rel="noopener noreferrer"/)
    }
  })

  it('IDs Stripe ausentes (null) mostram "—" em vez de um link quebrado', () => {
    const source = readPageSource()
    expect(source).toMatch(/row\.stripeInvoiceId \? \(/)
    expect(source).toMatch(/row\.stripePaymentIntentId \? \(/)
    expect(source).toMatch(/row\.stripeSubscriptionId \? \(/)
  })

  it('paginação é server-side (offset calculado a partir de page * PAGE_SIZE, enviado ao repository)', () => {
    const source = readPageSource()
    expect(source).toMatch(/offset: page \* PAGE_SIZE/)
    expect(source).not.toMatch(/\.slice\(page \*/)
  })

  it('ordenação é sempre por created_at DESC (nenhuma ordenação client-side)', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/\.sort\(/)
  })

  it('filtros V1 são só status e moeda — nenhum outro filtro/busca foi inventado', () => {
    const source = readPageSource()
    expect(source).toMatch(/statusFilter/)
    expect(source).toMatch(/currencyFilter/)
    expect(source).not.toMatch(/searchFilter|setSearch\(/)
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

  it('o estado vazio é honesto — nunca inventa "R$0,00" como receita, explica que transações aparecem quando houver pagamento real', () => {
    const source = readPageSource()
    expect(source).toMatch(/Não há transações registradas/)
    expect(source).toMatch(/pagamentos reais/)
  })

  it('admin-only: a página não reimplementa nenhuma checagem de role própria — a barreira real é a RLS (billing_transactions_select_admin) mais o app/admin/layout.tsx compartilhado (requireAdmin())', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/requireAdmin\(/)
    expect(source).not.toMatch(/is_platform_admin/)
    expect(source).not.toMatch(/role\s*===\s*['"]admin['"]/)
  })

  it('nenhum dado fictício/hardcoded é exibido — não há invoice/payment_intent/subscription id literal no JSX', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/in_[0-9a-zA-Z]{6,}/)
    expect(source).not.toMatch(/pi_[0-9a-zA-Z]{6,}/)
    expect(source).not.toMatch(/sub_[0-9a-zA-Z]{6,}/)
  })
})
