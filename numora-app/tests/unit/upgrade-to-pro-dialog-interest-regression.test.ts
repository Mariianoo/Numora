/**
 * tests/unit/upgrade-to-pro-dialog-interest-regression.test.ts
 * Etapa "5.10S — Pro Interest / Pré-lançamento".
 *
 * LIMITAÇÃO DOCUMENTADA (mesma de
 * tests/unit/account-delete-billing-guard-regression.test.ts): este
 * repositório não tem infraestrutura para renderizar um componente React
 * (vitest.config.mts roda `environment: 'node'`, sem jsdom, sem
 * testing-library, e o glob de inclusão só pega `tests/unit/**\/*.test.ts`
 * — nunca `.tsx`) — não é possível "clicar" no botão "Quero ser avisado" e
 * observar o DOM aqui. A lógica de repository (register/getStatus,
 * idempotência, plano inválido) já está coberta isoladamente em
 * tests/unit/plan-interest-repository.test.ts, e o RLS real em
 * tests/integration/plan-interest-rls.test.ts — o que falta cobrir é
 * exclusivamente a ORQUESTRAÇÃO dentro do componente: em que ordem as
 * coisas são chamadas, e que o novo botão nunca poderia acidentalmente
 * chamar Stripe/Checkout.
 *
 * Por isso este arquivo usa a mesma técnica de teste de caracterização já
 * estabelecida no projeto: inspeciona o CÓDIGO-FONTE de
 * `components/billing/UpgradeToProDialog.tsx` como texto. Cada asserção
 * abaixo corresponde diretamente a um item da checklist "5.10S — item 11"
 * (H/I/J/K/L) que não pode ser provado de outra forma neste repositório.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIALOG_FILE_PATH = path.resolve(__dirname, '../../components/billing/UpgradeToProDialog.tsx')

function readDialogSource(): string {
  return readFileSync(DIALOG_FILE_PATH, 'utf8')
}

describe('UpgradeToProDialog — orquestração do sinal de interesse (5.10S)', () => {
  it('o arquivo do componente existe e é legível (pré-condição do teste)', () => {
    expect(() => readDialogSource()).not.toThrow()
  })

  it('H) trackUpgradeInterestRegistered só é chamado DENTRO do bloco de sucesso de handleRegisterInterest, depois do await register(...)', () => {
    const source = readDialogSource()
    const handlerStart = source.indexOf('async function handleRegisterInterest')
    const handlerEnd = source.indexOf('async function handleUpgrade')
    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)

    const handlerBody = source.slice(handlerStart, handlerEnd)
    const registerCallIndex = handlerBody.indexOf('planInterestRepository.register(')
    const trackCallIndex = handlerBody.indexOf('trackUpgradeInterestRegistered(')

    expect(registerCallIndex).toBeGreaterThan(-1)
    expect(trackCallIndex).toBeGreaterThan(-1)
    // O evento só pode aparecer DEPOIS da chamada de registro no texto —
    // condição necessária (não suficiente sozinha) para "só dispara após
    // sucesso confirmado"; a condição J abaixo fecha o caso do catch.
    expect(trackCallIndex).toBeGreaterThan(registerCallIndex)
  })

  it('I) trackUpgradeInterestRegistered NUNCA aparece dentro do bloco catch externo de handleRegisterInterest (erro de banco não dispara o evento)', () => {
    const source = readDialogSource()
    const handlerStart = source.indexOf('async function handleRegisterInterest')
    const handlerEnd = source.indexOf('async function handleUpgrade')
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // O catch externo (o que trata falha de planInterestRepository.register)
    // é identificado pelo comentário-âncora deixado no código — se esse
    // comentário for removido/reescrito sem cuidado, este teste também
    // precisa ser revisado (falha alta, nunca um falso-positivo silencioso).
    const outerCatchAnchor = 'erro de banco NÃO dispara o evento'
    const anchorIndex = handlerBody.indexOf(outerCatchAnchor)
    expect(anchorIndex).toBeGreaterThan(-1)

    const catchBlockStart = handlerBody.indexOf('} catch (err) {', handlerBody.indexOf('await planInterestRepository.register('))
    const catchBlockEnd = handlerBody.indexOf('} finally {')
    expect(catchBlockStart).toBeGreaterThan(-1)
    expect(catchBlockEnd).toBeGreaterThan(catchBlockStart)

    // Busca pela CHAMADA real (com parêntese) — não pela menção em prosa no
    // comentário-âncora acima, que legitimamente cita o nome da função.
    const outerCatchBody = handlerBody.slice(catchBlockStart, catchBlockEnd)
    expect(outerCatchBody).not.toMatch(/trackUpgradeInterestRegistered\(/)
  })

  it('J) handleRegisterInterest nunca CHAMA /api/billing/checkout nem Stripe — clicar em "Quero ser avisado" nunca inicia Checkout', () => {
    const source = readDialogSource()
    const handlerStart = source.indexOf('async function handleRegisterInterest')
    const handlerEnd = source.indexOf('async function handleUpgrade')
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Procura pela SINTAXE de chamada real (string entre aspas, chamada de
    // função) — nunca pela menção em prosa nos comentários explicativos do
    // próprio handler, que legitimamente documentam "nunca chama X".
    expect(handlerBody).not.toMatch(/'\/api\/billing\/checkout'/)
    expect(handlerBody).not.toMatch(/getStripeClient\(/)
    expect(handlerBody).not.toMatch(/window\.location\.href\s*=/)
  })

  it('K) handleUpgrade (CTA principal de Checkout) continua chamando fetch("/api/billing/checkout") sem alteração de contrato', () => {
    const source = readDialogSource()
    const upgradeHandlerStart = source.indexOf('async function handleUpgrade')
    const upgradeHandlerBody = source.slice(upgradeHandlerStart)

    expect(upgradeHandlerBody).toMatch(/fetch\('\/api\/billing\/checkout'/)
    expect(upgradeHandlerBody).toMatch(/planSlug: targetPlanSlug, interval, currency, analyticsConsent/)
    expect(upgradeHandlerBody).toMatch(/window\.location\.href = body\.url/)
  })

  it('K) o botão de Checkout (Fazer upgrade para Pro) continua com onClick={handleUpgrade}, nunca substituído pelo novo handler', () => {
    const source = readDialogSource()
    expect(source).toMatch(/onClick=\{handleUpgrade\}/)
    expect(source).toMatch(/Fazer upgrade para Pro/)
  })

  it('L) existe um efeito que consulta planInterestRepository.getStatus(targetPlanSlug) quando isOpen fica true, refletindo o estado já ao abrir', () => {
    const source = readDialogSource()
    expect(source).toMatch(/planInterestRepository\s*\.\s*getStatus\(targetPlanSlug\)/)
    // O efeito precisa depender de isOpen (mesmo padrão do efeito de
    // upgrade_viewed já existente) — nunca rodar só uma vez no mount.
    const getStatusIndex = source.indexOf('.getStatus(targetPlanSlug)')
    const nextDepsArrayIndex = source.indexOf('}, [isOpen, targetPlanSlug])', getStatusIndex)
    expect(nextDepsArrayIndex).toBeGreaterThan(-1)
  })

  it('o novo botão "Quero ser avisado" usa targetPlanSlug (nunca um plano fixo "pro" hardcoded) ao registrar interesse', () => {
    const source = readDialogSource()
    expect(source).toMatch(/planInterestRepository\.register\(\{\s*planSlug:\s*targetPlanSlug,\s*source:\s*trigger\s*\}\)/)
  })

  it('nenhuma chamada nova a Stripe/getStripeClient foi introduzida neste arquivo (import continua ausente)', () => {
    const source = readDialogSource()
    expect(source).not.toMatch(/getStripeClient/)
    expect(source).not.toMatch(/from ['"]stripe['"]/)
  })
})
