/**
 * lib/stripe/assert-test-mode.ts
 * Etapa "Stripe 4.1A" — trava explícita contra rodar a futura sincronização
 * de preços (Stripe 4.1B) contra o Stripe LIVE por engano.
 *
 * Etapa "5.10Q-A — Live Billing Guards": esta função NÃO é mais chamada por
 * `getStripeClient()` — foi substituída pelo guard central
 * `assertBillingEnvironment` (`lib/billing/assert-billing-environment.ts`),
 * que sabe distinguir "LIVE nunca permitido" (Development/Preview) de
 * "LIVE permitido sob condição explícita" (Production + flag habilitada) —
 * distinção que esta função, sozinha, nunca teve como fazer (ela só olha
 * para a chave, nunca para o ambiente). Mantida aqui inalterada, ainda
 * exportada e testada (`tests/unit/stripe-assert-test-mode.test.ts`), para
 * não quebrar cobertura existente — mas hoje é código morto do ponto de
 * vista do app (nenhum caminho de produção a chama mais). Candidata a
 * remoção numa etapa futura de limpeza, fora do escopo desta.
 *
 * `STRIPE_TEST_KEY_PATTERN` é exportado para `lib/stripe/key-mode.ts`
 * reaproveitar — nunca uma segunda cópia divergente do mesmo regex.
 *
 * Formato real de uma chave secreta do Stripe: `sk_test_` ou `sk_live_`
 * seguido de uma string alfanumérica não-trivial (dezenas de caracteres).
 * Esta função nunca loga a chave em nenhuma mensagem de erro — só o
 * prefixo (`sk_test_`/`sk_live_`/nenhum) é seguro de mencionar.
 */
export const STRIPE_TEST_KEY_PATTERN = /^sk_test_[A-Za-z0-9]{16,}$/

export function assertStripeTestMode(secretKey: string): void {
  if (!secretKey || secretKey.trim().length === 0) {
    throw new Error('[assertStripeTestMode] STRIPE_SECRET_KEY está vazia — configure uma chave de TEST MODE (sk_test_...) antes de continuar.')
  }

  if (secretKey.startsWith('sk_live_')) {
    throw new Error(
      '[assertStripeTestMode] STRIPE_SECRET_KEY é uma chave LIVE (sk_live_...). ' +
        'Esta operação só pode rodar em TEST MODE — abortando antes de qualquer chamada ao Stripe.',
    )
  }

  if (!STRIPE_TEST_KEY_PATTERN.test(secretKey)) {
    throw new Error(
      '[assertStripeTestMode] STRIPE_SECRET_KEY não tem o formato esperado de uma chave de TEST MODE (sk_test_...). ' +
        'Verifique se copiou a chave secreta correta do Dashboard do Stripe (Developers → API keys, com "Test mode" ativado).',
    )
  }
}
