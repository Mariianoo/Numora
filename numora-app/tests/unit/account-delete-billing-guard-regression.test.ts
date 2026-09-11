/**
 * tests/unit/account-delete-billing-guard-regression.test.ts
 * Etapa "5.10P — Live Billing Guards: Tests First" — detector de
 * regressão para o achado crítico do 5.10O/5.10M: `app/api/account/delete/route.ts`
 * chama Stripe (via `cancelAllStripeSubscriptionsForAccountDeletion` →
 * `getStripeClient()`) mas NUNCA passa pelo guard de ambiente de billing
 * — é a única rota billing-adjacent sem nenhuma proteção de ambiente.
 *
 * LIMITAÇÃO DOCUMENTADA (seção 4 do prompt): este repositório não tem
 * infraestrutura para testar um Route Handler do Next.js com uma sessão
 * HTTP real "de fora" (precisaria subir um servidor real) — o mesmo
 * padrão já usado no projeto todo é chamar a função exportada diretamente
 * (ex.: `tests/unit/health-routes.test.ts`, `tests/unit/proxy-maintenance-mode.test.ts`).
 * Mas `POST` desta rota específica não pode ser chamado diretamente aqui
 * sem mockar toda a cadeia de Supabase/Storage/Stripe só para chegar até
 * o ponto que nos interessa — o que tornaria o teste frágil e indireto.
 *
 * Por isso este teste usa uma técnica diferente, mas igualmente válida
 * para um detector de regressão: inspeciona o CÓDIGO-FONTE do arquivo da
 * rota como texto e confirma que ele referencia o guard esperado. Isto é
 * deliberadamente um teste "de caracterização" — hoje ele FALHA de
 * verdade (a asserção não bate, não um erro de import) porque a rota
 * genuinamente não chama nenhum guard ainda. Quando a Etapa 5.10Q
 * adicionar a chamada a `assertBillingEnvironment(...)` nesta rota
 * (conforme o 5.10O determinou ser necessário), este teste passa a ficar
 * verde — e continua protegendo contra uma futura remoção acidental dessa
 * chamada.
 *
 * Diferente dos outros arquivos desta etapa (que falham por import
 * inexistente), ESTE arquivo roda normalmente — só a asserção falha. Ver
 * "5.10P — TEST-FIRST VERDICT" para a distinção entre os dois tipos de
 * RED.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTE_FILE_PATH = path.resolve(__dirname, '../../app/api/account/delete/route.ts')

function readRouteSource(): string {
  return readFileSync(ROUTE_FILE_PATH, 'utf8')
}

describe('app/api/account/delete/route.ts — deve chamar o guard de ambiente de billing (5.10O)', () => {
  it('o arquivo da rota existe e é legível (pré-condição do teste)', () => {
    expect(() => readRouteSource()).not.toThrow()
  })

  it('a rota chama Stripe indiretamente (cancelAllStripeSubscriptionsForAccountDeletion) — confirma que o risco é real, não hipotético', () => {
    const source = readRouteSource()
    expect(source).toMatch(/cancelAllStripeSubscriptionsForAccountDeletion/)
  })

  it('REGRESSÃO ESPERADA HOJE: a rota ainda NÃO chama assertBillingEnvironment (5.10O) antes do cancelamento Stripe', () => {
    const source = readRouteSource()
    // Nomeado explicitamente conforme o contrato aprovado na auditoria
    // 5.10O — não é um nome arbitrário inventado só para este teste.
    expect(source).toMatch(/assertBillingEnvironment\s*\(/)
  })

  it('quando o guard existir, deve ser chamado ANTES de cancelAllStripeSubscriptionsForAccountDeletion (ordem importa — nunca cancelar primeiro e validar depois)', () => {
    const source = readRouteSource()
    const guardIndex = source.indexOf('assertBillingEnvironment(')
    const stripeCallIndex = source.indexOf('cancelAllStripeSubscriptionsForAccountDeletion(')

    // Ambos ausentes hoje (-1, -1): este `it` fica RED junto com o anterior
    // até a Etapa 5.10Q implementar o guard — nunca deveria "passar por
    // acidente" só porque os dois estão ausentes.
    expect(guardIndex).toBeGreaterThan(-1)
    expect(stripeCallIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(stripeCallIndex)
  })
})
