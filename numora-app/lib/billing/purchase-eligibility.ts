/**
 * lib/billing/purchase-eligibility.ts
 * Etapa "B1 — Official Launch, código de cobrança" — política ÚNICA de
 * elegibilidade de compra da V1 comercial: SOMENTE Brasil, SOMENTE BRL.
 *
 * Regra (fail-closed): a compra só é elegível quando o país DO PERFIL do
 * usuário autenticado é exatamente `'BR'` E a moeda solicitada é exatamente
 * `'BRL'`. País nulo/vazio, qualquer outro país, qualquer outra moeda ou
 * qualquer entrada inesperada (tipo errado, caixa diferente) é REJEITADO —
 * nunca "normalizado" para caber.
 *
 * Autoridade: o país vem SEMPRE de `profiles.country_code` lido no servidor
 * (`loadOwnCountryCode`), nunca do corpo da requisição. A moeda enviada pelo
 * cliente só é COMPARADA com a moeda derivada do país — divergência é
 * rejeitada, e o resto do fluxo usa a moeda derivada (`eligibility.currency`).
 *
 * Módulo puro (a única função com I/O recebe o client por parâmetro) e sem
 * imports server-only, para ser usado tanto pelas rotas de cobrança quanto
 * pela UI da página de planos — nunca duas versões da mesma regra. Esta
 * política é DELIBERADAMENTE separada de `resolveCurrencyFromCountryCode`
 * (lib/stripe/resolve-currency.ts): aquela função continua só mapeando
 * país→moeda para telas não comerciais; quem decide se uma COMPRA é
 * permitida é este módulo.
 *
 * Abrir outros países/moedas no futuro é uma decisão de produto explícita
 * (mudar as duas constantes abaixo e criar/ativar os Prices correspondentes)
 * — nunca um efeito colateral de um preço existir no catálogo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const PURCHASE_ELIGIBLE_COUNTRY = 'BR'
export const PURCHASE_ELIGIBLE_CURRENCY = 'BRL'

export type PurchaseIneligibleReason = 'country_missing' | 'country_not_supported' | 'currency_mismatch' | 'invalid_input'

export type PurchaseEligibility = { eligible: true; currency: typeof PURCHASE_ELIGIBLE_CURRENCY } | { eligible: false; reason: PurchaseIneligibleReason }

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * Decisão completa (país + moeda) — usada pelas rotas de cobrança. A ordem
 * das checagens importa para a UX: país ausente/não suportado vem ANTES de
 * moeda divergente, então quem está fora do Brasil vê a mensagem de
 * disponibilidade, não um erro de moeda.
 */
export function evaluatePurchaseEligibility(input: { countryCode: unknown; currency: unknown }): PurchaseEligibility {
  const { countryCode, currency } = input

  if (isBlank(countryCode)) {
    return { eligible: false, reason: 'country_missing' }
  }
  if (typeof countryCode !== 'string') {
    return { eligible: false, reason: 'invalid_input' }
  }
  if (countryCode !== PURCHASE_ELIGIBLE_COUNTRY) {
    return { eligible: false, reason: 'country_not_supported' }
  }
  if (typeof currency !== 'string') {
    return { eligible: false, reason: 'invalid_input' }
  }
  if (currency !== PURCHASE_ELIGIBLE_CURRENCY) {
    return { eligible: false, reason: 'currency_mismatch' }
  }

  return { eligible: true, currency: PURCHASE_ELIGIBLE_CURRENCY }
}

export type PurchaseAvailability = 'eligible' | 'country_missing' | 'country_not_supported'

/**
 * Só o PAÍS — para a UI decidir o que mostrar (nunca é a barreira real; a
 * barreira é `evaluatePurchaseEligibility` no servidor). Qualquer valor que
 * não seja exatamente `'BR'` e não seja "ausente" cai em `country_not_supported`
 * (fail-closed).
 */
export function getPurchaseAvailability(countryCode: unknown): PurchaseAvailability {
  if (isBlank(countryCode)) return 'country_missing'
  return countryCode === PURCHASE_ELIGIBLE_COUNTRY ? 'eligible' : 'country_not_supported'
}

export const PURCHASE_COUNTRY_MISSING_MESSAGE = 'Informe seu país no perfil para verificar a disponibilidade do plano.'
export const PURCHASE_REGION_UNAVAILABLE_MESSAGE = 'O plano Pro está disponível apenas no Brasil por enquanto.'
const PURCHASE_INVALID_REQUEST_MESSAGE = 'Não foi possível iniciar a contratação com os dados informados.'

export interface PurchaseIneligibleResponse {
  status: number
  body: { error: string; code: 'country_missing' | 'region_unavailable' | 'invalid_request' }
}

/** Resposta HTTP neutra por motivo — nunca revela catálogo, Stripe, IDs ou detalhe interno. */
export function getPurchaseIneligibleResponse(reason: PurchaseIneligibleReason): PurchaseIneligibleResponse {
  switch (reason) {
    case 'country_missing':
      return { status: 403, body: { error: PURCHASE_COUNTRY_MISSING_MESSAGE, code: 'country_missing' } }
    case 'country_not_supported':
      return { status: 403, body: { error: PURCHASE_REGION_UNAVAILABLE_MESSAGE, code: 'region_unavailable' } }
    default:
      return { status: 400, body: { error: PURCHASE_INVALID_REQUEST_MESSAGE, code: 'invalid_request' } }
  }
}

/**
 * Lê o país do PRÓPRIO perfil no servidor. Lança em erro de consulta (o
 * chamador deve tratar como "não foi possível verificar" — fail-closed,
 * nunca como elegível). Sem linha de perfil = `null` (país ausente).
 */
export async function loadOwnCountryCode(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('country_code').eq('id', userId).maybeSingle()

  if (error) {
    throw new Error(`[purchase-eligibility] Falha ao ler o país do perfil: ${error.message}`)
  }

  const value = (data as { country_code: string | null } | null)?.country_code ?? null
  return value
}
