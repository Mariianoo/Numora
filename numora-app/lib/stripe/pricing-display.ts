/**
 * lib/stripe/pricing-display.ts
 * Etapa "5.10D — Billing Commercial Foundation" — cálculos de apresentação
 * derivados do catálogo comercial real (`plan_prices`), nunca um percentual
 * fixo/hardcoded. Funções puras, sem I/O.
 */

/**
 * Percentual de economia do preço anual frente a 12x o preço mensal.
 * Arredondado sempre PARA BAIXO — nunca prometer mais economia do que
 * existe de fato (ex.: 16.7% vira 16%, nunca 17%).
 */
export function computeYearlySavingsPercent(monthlyAmount: number, yearlyAmount: number): number {
  if (monthlyAmount <= 0) return 0

  const yearlyAtMonthlyRate = monthlyAmount * 12
  const savings = 1 - yearlyAmount / yearlyAtMonthlyRate

  return Math.max(0, Math.floor(savings * 100))
}
