/**
 * tests/unit/admin-subscriptions-migration-regression.test.ts
 * Etapa "Admin Subscriptions V1" — inspeção ESTÁTICA da migration que cria
 * `admin_list_subscriptions()`/`admin_subscriptions_summary()`. Cobre o que
 * a integração (`tests/integration/admin-subscriptions.test.ts`) não pode
 * provar sem dado real: que as funções NUNCA leem `benefit_grants`,
 * `internal_test_accounts`, `effective_plans()`/`get_effective_plan()` nem
 * `billing_webhook_events` — nunca confundir assinatura Stripe real com
 * cortesia/Conta de Análise (auditoria "Admin Subscriptions V1", seção D).
 *
 * A definição VIGENTE de `admin_list_subscriptions()` é a da migration
 * corretiva `20260922134507` (que só corrige `pp.currency::text` — achado
 * real de `42804`/estrutura de retorno na Fase 3 de validação, descoberto
 * chamando a função de verdade via RPC, nunca visível numa query solta em
 * SQL). `admin_subscriptions_summary()` continua definida só na migration
 * original (`20260922133819`) — nunca foi tocada pela correção.
 *
 * Busca por USO real (nome de tabela/função dentro do corpo SQL), nunca por
 * palavra solta — mesmo cuidado já documentado em outras suítes desta base
 * de código (ver tests/unit/analysis-account-page-regression.test.ts) para
 * nunca confundir menção em comentário com uso real. Aqui o corpo inteiro é
 * SQL/plpgsql (não há "prosa" separada do código), então a busca é direta.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')
const ORIGINAL_MIGRATION_PATH = path.join(MIGRATIONS_DIR, '20260922133819_create_admin_subscriptions_rpcs.sql')
const FIX_MIGRATION_PATH = path.join(MIGRATIONS_DIR, '20260922134507_fix_admin_list_subscriptions_currency_type.sql')

/**
 * Reconstrói o texto EFETIVO das duas funções, como o Postgres as vê hoje:
 * `admin_subscriptions_summary()` só existe na migration original (nunca
 * tocada pela correção); a definição VIGENTE de `admin_list_subscriptions()`
 * é a da migration corretiva (`create or replace`, substitui inteiramente a
 * anterior) — por isso a versão stale é removida daqui antes de qualquer
 * asserção, para nunca validar uma definição que o banco já não usa mais.
 */
function readMigrationSource(): string {
  const original = readFileSync(ORIGINAL_MIGRATION_PATH, 'utf8')
  const fix = readFileSync(FIX_MIGRATION_PATH, 'utf8')

  const staleStart = original.indexOf('create or replace function public.admin_list_subscriptions')
  const staleEnd = original.indexOf('create or replace function public.admin_subscriptions_summary')
  if (staleStart === -1 || staleEnd === -1 || staleEnd <= staleStart) {
    throw new Error('[test] não foi possível localizar o bloco stale de admin_list_subscriptions na migration original')
  }

  const originalWithoutStaleBlock = original.slice(0, staleStart) + original.slice(staleEnd)
  return `${originalWithoutStaleBlock}\n${fix}`
}

/**
 * Extrai SÓ o corpo executável das duas funções (o texto entre `$$ ... $$`
 * de cada `create or replace function`) — nunca os comentários `-- ...` do
 * cabeçalho nem a string de `comment on function ... is '...'`, que
 * documentam EM PROSA justamente as tabelas/funções que o código nunca usa
 * (ex.: "nunca chama effective_plans()", "nunca benefit_grants/internal_test
 * ... na string do `comment on function`). Uma busca ingênua no arquivo
 * inteiro encontraria "uso" onde só há explicação — mesmo cuidado já
 * documentado em outras suítes desta base de código. Os testes de
 * isolamento de dados abaixo rodam só contra a LÓGICA SQL de verdade.
 */
function readMigrationFunctionBodies(): string {
  const source = readMigrationSource()
  const bodies = [...source.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((match) => match[1])
  if (bodies.length !== 2) {
    throw new Error(`[test] esperava exatamente 2 corpos de função ($$...$$) na migration, encontrou ${bodies.length}`)
  }
  return bodies.join('\n')
}

describe('migration admin_list_subscriptions/admin_subscriptions_summary — isolamento de dados (Admin Subscriptions V1)', () => {
  it('o arquivo da migration existe e é legível (pré-condição do teste)', () => {
    expect(() => readMigrationSource()).not.toThrow()
  })

  it('nunca referencia benefit_grants (cortesia/beta/partnership/admin/internal_test) no código SQL executável', () => {
    const code = readMigrationFunctionBodies()
    expect(code).not.toMatch(/benefit_grants/i)
  })

  it('nunca referencia internal_test_accounts (Conta de Análise) no código SQL executável', () => {
    const code = readMigrationFunctionBodies()
    expect(code).not.toMatch(/internal_test_accounts/i)
  })

  it('nunca chama effective_plans()/get_effective_plan() no código SQL executável — o plano exibido é sempre o da subscription, nunca o "plano efetivo"', () => {
    const code = readMigrationFunctionBodies()
    expect(code).not.toMatch(/effective_plans\(/i)
    expect(code).not.toMatch(/get_effective_plan\(/i)
  })

  it('nunca lê billing_webhook_events no código SQL executável (ledger interno de idempotência, não é dado de negócio)', () => {
    const code = readMigrationFunctionBodies()
    expect(code).not.toMatch(/billing_webhook_events/i)
  })

  it('a fonte de dados da listagem é exclusivamente public.subscriptions (FROM), nunca outra tabela como origem', () => {
    const code = readMigrationFunctionBodies()
    expect(code).toMatch(/from public\.subscriptions s\b/)
  })
})

describe('migration admin_list_subscriptions/admin_subscriptions_summary — segurança (revisão explícita, não só is_platform_admin())', () => {
  it('as duas funções são SECURITY DEFINER com search_path vazio (não "public")', () => {
    const source = readMigrationSource()
    const definitions = source.split(/create or replace function/i).slice(1)
    expect(definitions).toHaveLength(2)
    for (const def of definitions) {
      expect(def).toMatch(/security definer/i)
      expect(def).toMatch(/set search_path = ''/)
    }
  })

  it('as duas funções checam is_platform_admin() ANTES de qualquer leitura (primeira instrução do corpo)', () => {
    const source = readMigrationSource()
    const definitions = source.split(/create or replace function/i).slice(1)
    for (const def of definitions) {
      const beginIndex = def.indexOf('begin')
      const checkIndex = def.indexOf('if not public.is_platform_admin() then')
      const firstSelectIndex = def.indexOf('return query')
      expect(checkIndex).toBeGreaterThan(beginIndex)
      expect(checkIndex).toBeLessThan(firstSelectIndex)
    }
  })

  it('todas as referências a tabelas/funções do schema public são schema-qualificadas (public.<nome>)', () => {
    const source = readMigrationSource()
    // Nomes de tabela conhecidos do domínio — cada ocorrência como FROM/JOIN
    // alvo precisa vir prefixada de "public.".
    for (const table of ['subscriptions', 'profiles', 'plans', 'billing_customers', 'plan_prices', 'billing_transactions']) {
      const unqualified = new RegExp(`[^.]\\b(from|join)\\s+${table}\\b`, 'i')
      expect(source).not.toMatch(unqualified)
    }
  })

  it('nenhuma das duas funções contém INSERT/UPDATE/DELETE — somente leitura', () => {
    const source = readMigrationSource()
    expect(source).not.toMatch(/\binsert into\b/i)
    expect(source).not.toMatch(/\bupdate\s+public\./i)
    expect(source).not.toMatch(/\bdelete from\b/i)
  })

  it('nenhum SQL dinâmico (execute/format) em nenhuma das duas funções', () => {
    const source = readMigrationSource()
    expect(source).not.toMatch(/\bexecute\s+(format|'|")/i)
  })

  it('grants: revoke de public/anon e grant só para authenticated, para as duas funções', () => {
    const source = readMigrationSource()
    expect(source).toMatch(/revoke execute on function public\.admin_list_subscriptions\([^)]*\) from public, anon;/)
    expect(source).toMatch(/grant execute on function public\.admin_list_subscriptions\([^)]*\) to authenticated;/)
    expect(source).toMatch(/revoke execute on function public\.admin_subscriptions_summary\(\) from public, anon;/)
    expect(source).toMatch(/grant execute on function public\.admin_subscriptions_summary\(\) to authenticated;/)
  })

  it('nenhuma referência a service_role/secret/senha/chave Stripe/e-mail fixo em nenhuma das duas funções', () => {
    const source = readMigrationSource()
    expect(source).not.toMatch(/service_role/i)
    expect(source).not.toMatch(/secret/i)
    expect(source).not.toMatch(/password|senha/i)
    expect(source).not.toMatch(/sk_live|sk_test|whsec_/i)
    expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  })

  it('nenhum parâmetro permite contornar a checagem de admin (nenhum "as_user"/"skip_check"/"bypass")', () => {
    const source = readMigrationSource()
    expect(source).not.toMatch(/p_as_user|p_skip_check|p_bypass|p_admin_override/i)
  })

  it('paginação tem teto de 200 e usa least/greatest (nunca "select * de tudo")', () => {
    const source = readMigrationSource()
    expect(source).toMatch(/limit least\(coalesce\(p_limit, 50\), 200\)/)
    expect(source).toMatch(/offset greatest\(coalesce\(p_offset, 0\), 0\)/)
  })

  it('currency é convertida explicitamente de bpchar para text (achado real da Fase 3 — erro 42804 ao chamar a RPC de verdade)', () => {
    const source = readMigrationSource()
    expect(source).toMatch(/pp\.currency::text as currency/)
  })

  it('a última transação usa LATERAL (1 query, sem N+1) — nunca uma subquery correlacionada em loop client-side', () => {
    const source = readMigrationSource()
    expect(source).toMatch(/left join lateral \(/)
    expect(source).toMatch(/cross join lateral \(/)
  })
})
