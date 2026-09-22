/**
 * lib/format/mask-stripe-id.ts
 * Etapa "Admin Subscriptions V1" — mascara um ID Stripe (`cus_...`,
 * `sub_...`) para EXIBIÇÃO na UI administrativa. Função pura, sem I/O.
 *
 * NUNCA usar o valor mascarado para nada além de texto visual — o `href`
 * dos links do Stripe Dashboard (ver `lib/stripe/dashboard-links.ts`) usa
 * sempre o ID REAL retornado pelo repository, nunca este valor. Este
 * arquivo nunca persiste nada — é chamado a cada renderização, a partir do
 * ID real já carregado.
 *
 * Formato: `<prefixo>_` preservado (ex.: `cus_`, `sub_`), seguido de 8
 * asteriscos fixos e os 4 últimos caracteres reais — ex.:
 * `cus_1234567890abcdef` → `cus_********cdef`. Uma string sem "_" (sem
 * prefixo reconhecível) mascara tudo exceto os últimos 4 caracteres.
 */
const VISIBLE_SUFFIX_LENGTH = 4
const MASK_LENGTH = 8

export function maskStripeId(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const separatorIndex = value.indexOf('_')
  const prefix = separatorIndex === -1 ? '' : value.slice(0, separatorIndex + 1)
  const rest = separatorIndex === -1 ? value : value.slice(separatorIndex + 1)

  if (rest.length <= VISIBLE_SUFFIX_LENGTH) {
    // Curta demais para revelar um sufixo sem expor o ID inteiro — mascara
    // por completo (nunca um `slice(-4)` negativo/maior que o próprio valor).
    return `${prefix}${'*'.repeat(Math.max(rest.length, 1))}`
  }

  const visibleSuffix = rest.slice(-VISIBLE_SUFFIX_LENGTH)
  return `${prefix}${'*'.repeat(MASK_LENGTH)}${visibleSuffix}`
}
