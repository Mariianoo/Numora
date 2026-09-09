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
 *
 * Etapa "Stripe 5.5 — Invoice & Payment Sync": `fromStripeMinorUnits` é a
 * conversão INVERSA (minor units do Stripe, ex. `invoice.amount_paid`,
 * sempre um inteiro → valor decimal, para gravar em
 * `billing_transactions.amount numeric(10,2)`). Implementada via
 * manipulação de dígitos em STRING (nunca uma divisão de ponto flutuante
 * como `minorUnits / 100`) — determinística, sem depender de nenhum
 * comportamento de arredondamento de IEEE754 para "sair certa".
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

/**
 * Inversa de `toStripeMinorUnits` — sempre recebe um INTEIRO (é assim que o
 * Stripe sempre representa minor units, ex.: `1990` para R$ 19,90). Constrói
 * a string decimal exata via slicing de dígitos (nunca `minorUnits / 100`)
 * e só então converte para `number` — o `number` final é sempre a
 * representação IEEE754 mais próxima da string exata, a MESMA que
 * `JSON.stringify`/PostgREST devolvem ao serializar de volta (nunca uma
 * imprecisão introduzida por uma divisão).
 */
export function fromStripeMinorUnits(minorUnits: number): number {
  if (typeof minorUnits !== 'number' || !Number.isFinite(minorUnits) || !Number.isInteger(minorUnits)) {
    throw new Error(`[fromStripeMinorUnits] Valor inválido — minor units do Stripe são sempre um inteiro: ${String(minorUnits)}`)
  }
  if (minorUnits < 0) {
    throw new Error(`[fromStripeMinorUnits] Valor precisa ser não-negativo: ${minorUnits}`)
  }

  const digits = Math.abs(minorUnits).toString().padStart(3, '0')
  const majorDigits = digits.slice(0, -2)
  const minorDigits = digits.slice(-2)

  return Number(`${majorDigits}.${minorDigits}`)
}
