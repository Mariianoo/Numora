/**
 * tests/unit/analysis-account-page-regression.test.ts
 * Etapa "5.10W.4 — Conta de Análise: Painel Administrativo".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de outras suítes desta base de código —
 * ver tests/unit/grant-courtesy-modal-regression.test.ts,
 * tests/unit/collection-page-export-regression.test.ts): este repositório
 * não tem infraestrutura para renderizar `app/admin/analysis-account/page.tsx`
 * (`environment: 'node'`, sem jsdom/testing-library) — não é possível
 * clicar nos botões e observar o DOM aqui. A lógica do repository já está
 * coberta isoladamente em tests/unit/analysis-account-repository.test.ts
 * — este arquivo cobre a ORQUESTRAÇÃO da página: que os botões certos
 * chamam os métodos certos do repository, que a confirmação de reset
 * existe, que nada é hardcoded, e que nenhuma chamada Stripe/Supabase
 * direta/impersonation aparece no código da página.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE_FILE_PATH = path.resolve(__dirname, '../../app/admin/analysis-account/page.tsx')

function readPageSource(): string {
  return readFileSync(PAGE_FILE_PATH, 'utf8')
}

describe('app/admin/analysis-account/page.tsx — orquestração (5.10W.4)', () => {
  it('o arquivo da página existe e é legível (pré-condição do teste)', () => {
    expect(() => readPageSource()).not.toThrow()
  })

  it('1/2. a página carrega o estado via analysisAccountRepository.getState() em um efeito de montagem', () => {
    const source = readPageSource()
    expect(source).toMatch(/analysisAccountRepository\.getState\(\)/)
    expect(source).toMatch(/useEffect\(\(\) => \{\s*loadState\(\)/)
  })

  it('3/4/5. os 3 botões de plano (Free/Pro/Premium) chamam handleSwitchPlan com o slug correto', () => {
    const source = readPageSource()
    expect(source).toMatch(/onClick=\{\(\) => handleSwitchPlan\(plan\)\}/)
    expect(source).toMatch(/PLAN_OPTIONS: AnalysisAccountPlanSlug\[\] = \['free', 'pro', 'premium'\]/)
  })

  it('6. handleSwitchPlan chama SOMENTE analysisAccountRepository.switchPlan — nunca escreve em benefit_grants/Supabase diretamente', () => {
    const source = readPageSource()
    const start = source.indexOf('async function handleSwitchPlan')
    const end = source.indexOf('async function handlePopulate')
    const body = source.slice(start, end)

    expect(body).toMatch(/analysisAccountRepository\.switchPlan\(plan\)/)
    expect(body).not.toMatch(/benefit_grants/)
    expect(body).not.toMatch(/getSupabaseBrowserClient/)
    expect(body).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
  })

  it('7. handlePopulate chama SOMENTE analysisAccountRepository.populateDataset — trata populated=false como mensagem amigável, nunca erro', () => {
    const source = readPageSource()
    const start = source.indexOf('async function handlePopulate')
    const end = source.indexOf('async function handleReset')
    const body = source.slice(start, end)

    expect(body).toMatch(/analysisAccountRepository\.populateDataset\(\)/)
    expect(body).toMatch(/result\.populated/)
    expect(body).not.toMatch(/setPopulateError\(.*populated/)
  })

  it('8/14. handleReset chama SOMENTE analysisAccountRepository.resetDataset — nenhum DELETE direto no client', () => {
    const source = readPageSource()
    const start = source.indexOf('async function handleReset')
    const body = source.slice(start)

    expect(body).toMatch(/analysisAccountRepository\.resetDataset\(\)/)
    expect(body).not.toMatch(/\.delete\(/)
    expect(body).not.toMatch(/getSupabaseBrowserClient/)
  })

  it('9. o reset exige confirmação explícita via ConfirmDialog antes de chamar handleReset', () => {
    const source = readPageSource()
    expect(source).toMatch(/<ConfirmDialog/)
    expect(source).toMatch(/onConfirm=\{handleReset\}/)
    expect(source).toMatch(/isResetConfirmOpen/)
    // O botão "Resetar" abre a confirmação — nunca chama handleReset diretamente.
    expect(source).toMatch(/onClick=\{\(\) => setIsResetConfirmOpen\(true\)\}/)
  })

  it('10. loading/desabilitação: cada ação tem seu próprio guard contra clique duplo/concorrente', () => {
    const source = readPageSource()
    expect(source).toMatch(/if \(switchingPlan !== null\) return/)
    expect(source).toMatch(/if \(isPopulating\) return/)
    expect(source).toMatch(/disabled=\{!isOwner \|\| switchingPlan !== null \|\| state\.planSlug === plan\}/)
    expect(source).toMatch(/disabled=\{!isOwner \|\| isPopulating\}/)
  })

  it('11. erros passam por friendlyAnalysisAccountError (nunca SQL bruto/stack trace exibido diretamente)', () => {
    const source = readPageSource()
    expect(source).toMatch(/function friendlyAnalysisAccountError/)
    expect(source).toMatch(/setPlanError\(friendlyAnalysisAccountError\(err\)\)/)
    expect(source).toMatch(/setPopulateError\(friendlyAnalysisAccountError\(err\)\)/)
    expect(source).toMatch(/setResetError\(friendlyAnalysisAccountError\(err\)\)/)
    expect(source).toMatch(/getUserFriendlyErrorMessage/)
  })

  it('12. a troca de plano nunca chama populate/reset — dataset não é alterado ao trocar plano', () => {
    const source = readPageSource()
    const start = source.indexOf('async function handleSwitchPlan')
    const end = source.indexOf('async function handlePopulate')
    const body = source.slice(start, end)

    expect(body).not.toMatch(/populateDataset|resetDataset/)
  })

  it('13. nenhuma referência a Stripe em nenhum ponto da página', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/[Ss]tripe/)
    expect(source).not.toMatch(/\/api\/billing/)
  })

  it('15/16. nenhum user_id ou e-mail hardcoded — o alvo é sempre resolvido pelo repository (internal_test_accounts)', () => {
    const source = readPageSource()
    // Nenhum UUID literal nem endereço de e-mail embutido no código da página.
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  })

  it('SEM impersonation: nenhum mecanismo real de "entrar como"/troca de sessão — só uma nota informativa sobre credenciais próprias', () => {
    const source = readPageSource()
    // Busca por USO real (chamada de função/import), nunca pela palavra em
    // si — o cabeçalho do arquivo legitimamente documenta "SEM
    // impersonation" em prosa.
    expect(source).not.toMatch(/signInAs\(|signInWithPassword\(|admin\.auth\./)
    expect(source).not.toMatch(/setSession\(|impersonate\(/i)
    expect(source).toMatch(/credenciais próprias da Conta de Análise/)
  })

  it('nenhuma senha/credencial armazenada ou exibida', () => {
    const source = readPageSource()
    expect(source).not.toMatch(/password|senha\s*[:=]/i)
  })

  it('leitura (getState) não é gated por isOwner — só as ações de escrita (troca de plano/popular/resetar) são', () => {
    const source = readPageSource()
    const loadStateIndex = source.indexOf('const loadState = useCallback')
    const loadStateBody = source.slice(loadStateIndex, source.indexOf('useEffect', loadStateIndex))
    expect(loadStateBody).not.toMatch(/isOwner/)

    expect(source).toMatch(/disabled=\{!isOwner/)
  })
})
