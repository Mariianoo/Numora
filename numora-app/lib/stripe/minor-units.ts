/**
 * lib/stripe/minor-units.ts
 * Etapa "Stripe 4.1A" — conversão de um valor comercial "de unidade
 * inteira" (ex.: 19.90, como está em `plan_prices.amount`) para minor
 * units (centavos), formato exigido pela API do Stripe
 * (`unit_amount`/`amount`). BRL e USD são as únicas moedas suportadas
 * nesta fase (Stripe 1/2/3) — ambas têm exatamente 2 casas decimais, então
 * o fator é sempre 100 (nenhuma moeda de 0 ou 3 casas decimais, como JPY
 * ou BHD, está em escopo).
 *
 * `Math.round` (não truncar, não converter ingenuamente) é obrigatório: em
 * ponto flutuante, `19.90 * 100` pode resultar em `1989.9999999999998` —
 * arredondar para o inteiro mais próximo corrige isso corretamente. A
 * checagem de precisão abaixo existe para capturar entradas genuinamente
 * inválidas (mais de 2 casas decimais), nunca para rejeitar o erro de
 * ponto flutuante esperado de valores como 19.90.
 */
export function toStripeMinorUnits(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error(`[toStripeMinorUnits] Valor inválido: ${String(amount)}`)
  }
  if (amount <= 0) {
    throw new Error(`[toStripeMinorUnits] Valor precisa ser positivo: ${amount}`)
  }

  const minorUnits = Math.round(amount * 100)

  // Tolerância pequena o suficiente para absorver imprecisão de ponto
  // flutuante (ex.: 19.90 * 100 = 1989.9999999999998), grande o
  // suficiente para rejeitar uma 3ª casa decimal genuína (ex.: 19.999).
  if (Math.abs(minorUnits - amount * 100) > 0.02) {
    throw new Error(`[toStripeMinorUnits] Valor com precisão inválida (mais de 2 casas decimais?): ${amount}`)
  }

  return minorUnits
}
