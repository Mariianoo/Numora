/**
 * tests/unit/purchase-eligibility.test.ts
 * Etapa "B1 — Official Launch, código de cobrança" — a política ÚNICA de
 * elegibilidade de compra da V1 (somente Brasil, somente BRL) com
 * comportamento real (função pura, sem mock). A aplicação nas rotas está em
 * tests/unit/premium-purchase-guard.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  PURCHASE_COUNTRY_MISSING_MESSAGE,
  PURCHASE_ELIGIBLE_COUNTRY,
  PURCHASE_ELIGIBLE_CURRENCY,
  PURCHASE_REGION_UNAVAILABLE_MESSAGE,
  evaluatePurchaseEligibility,
  getPurchaseAvailability,
  getPurchaseIneligibleResponse,
  loadOwnCountryCode,
} from '@/lib/billing/purchase-eligibility'

describe('evaluatePurchaseEligibility — matriz país × moeda (V1: somente Brasil/BRL)', () => {
  it('BR + BRL → elegível, com a moeda DERIVADA', () => {
    expect(evaluatePurchaseEligibility({ countryCode: 'BR', currency: 'BRL' })).toEqual({ eligible: true, currency: 'BRL' })
  })

  it('BR + USD → rejeitado por moeda divergente (nunca confia na moeda do cliente)', () => {
    expect(evaluatePurchaseEligibility({ countryCode: 'BR', currency: 'USD' })).toEqual({ eligible: false, reason: 'currency_mismatch' })
  })

  it.each([
    ['NULL + BRL', null, 'BRL'],
    ['NULL + USD', null, 'USD'],
    ['undefined + BRL', undefined, 'BRL'],
    ['string vazia + BRL', '', 'BRL'],
    ['só espaços + BRL', '   ', 'BRL'],
  ])('%s → country_missing', (_label, countryCode, currency) => {
    expect(evaluatePurchaseEligibility({ countryCode, currency })).toEqual({ eligible: false, reason: 'country_missing' })
  })

  it.each([
    ['US + USD', 'US', 'USD'],
    ['US + BRL (arbitragem de preço)', 'US', 'BRL'],
    ['PT + BRL', 'PT', 'BRL'],
    ['AR + USD', 'AR', 'USD'],
    ['país desconhecido', 'XX', 'BRL'],
    ['minúsculo "br" (sem normalização)', 'br', 'BRL'],
    ['"BR " com espaço (sem normalização)', 'BR ', 'BRL'],
    ['nome por extenso', 'Brasil', 'BRL'],
  ])('%s → country_not_supported', (_label, countryCode, currency) => {
    expect(evaluatePurchaseEligibility({ countryCode, currency })).toEqual({ eligible: false, reason: 'country_not_supported' })
  })

  it.each([
    ['BRL minúsculo', 'brl'],
    ['moeda desconhecida', 'EUR'],
    ['moeda vazia', ''],
    ['USD', 'USD'],
  ])('BR + %s → currency_mismatch', (_label, currency) => {
    expect(evaluatePurchaseEligibility({ countryCode: 'BR', currency })).toEqual({ eligible: false, reason: 'currency_mismatch' })
  })

  it.each([
    ['país numérico', 55, 'BRL'],
    ['país objeto', { code: 'BR' }, 'BRL'],
    ['país array', ['BR'], 'BRL'],
    ['moeda null com país BR', 'BR', null],
    ['moeda undefined com país BR', 'BR', undefined],
    ['moeda numérica com país BR', 'BR', 986],
  ])('entrada inesperada (%s) → invalid_input (fail-closed)', (_label, countryCode, currency) => {
    expect(evaluatePurchaseEligibility({ countryCode, currency })).toEqual({ eligible: false, reason: 'invalid_input' })
  })

  it('a ordem das checagens prioriza o país: quem está fora do Brasil vê a mensagem de disponibilidade, não um erro de moeda', () => {
    expect(evaluatePurchaseEligibility({ countryCode: 'US', currency: 'USD' })).toEqual({ eligible: false, reason: 'country_not_supported' })
    expect(evaluatePurchaseEligibility({ countryCode: null, currency: 'USD' })).toEqual({ eligible: false, reason: 'country_missing' })
  })

  it('as constantes da V1 são exatamente Brasil e BRL (abrir outro país/moeda exige mudança explícita)', () => {
    expect(PURCHASE_ELIGIBLE_COUNTRY).toBe('BR')
    expect(PURCHASE_ELIGIBLE_CURRENCY).toBe('BRL')
  })
})

describe('getPurchaseAvailability — só o país (apresentação)', () => {
  it('BR → eligible', () => {
    expect(getPurchaseAvailability('BR')).toBe('eligible')
  })

  it.each([null, undefined, '', '  '])('%j → country_missing', (value) => {
    expect(getPurchaseAvailability(value)).toBe('country_missing')
  })

  it.each(['US', 'PT', 'br', 'XX', 'Brasil', 55, {}])('%j → country_not_supported (qualquer coisa que não seja exatamente BR)', (value) => {
    expect(getPurchaseAvailability(value)).toBe('country_not_supported')
  })

  it('concorda com evaluatePurchaseEligibility para todo país (a UI nunca diverge da barreira)', () => {
    for (const country of ['BR', 'US', null, '', 'XX', 'br']) {
      const availability = getPurchaseAvailability(country)
      const server = evaluatePurchaseEligibility({ countryCode: country, currency: 'BRL' })
      expect(server.eligible).toBe(availability === 'eligible')
    }
  })
})

describe('getPurchaseIneligibleResponse — respostas neutras', () => {
  it('country_missing → 403 + orientação para informar o país', () => {
    expect(getPurchaseIneligibleResponse('country_missing')).toEqual({ status: 403, body: { error: PURCHASE_COUNTRY_MISSING_MESSAGE, code: 'country_missing' } })
    expect(PURCHASE_COUNTRY_MISSING_MESSAGE).toBe('Informe seu país no perfil para verificar a disponibilidade do plano.')
  })

  it('country_not_supported → 403 + "apenas no Brasil por enquanto"', () => {
    expect(getPurchaseIneligibleResponse('country_not_supported')).toEqual({ status: 403, body: { error: PURCHASE_REGION_UNAVAILABLE_MESSAGE, code: 'region_unavailable' } })
    expect(PURCHASE_REGION_UNAVAILABLE_MESSAGE).toBe('O plano Pro está disponível apenas no Brasil por enquanto.')
  })

  it.each(['currency_mismatch', 'invalid_input'] as const)('%s → 400 genérico (não diz qual moeda seria aceita)', (reason) => {
    const response = getPurchaseIneligibleResponse(reason)
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('invalid_request')
    expect(response.body.error).not.toMatch(/BRL|USD|BR\b|Brasil|moeda/i)
  })

  it('nenhuma resposta cita Stripe, catálogo, IDs ou preço', () => {
    for (const reason of ['country_missing', 'country_not_supported', 'currency_mismatch', 'invalid_input'] as const) {
      expect(JSON.stringify(getPurchaseIneligibleResponse(reason))).not.toMatch(/stripe|price_|cus_|catálogo|catalog|R\$|\$/i)
    }
  })
})

describe('loadOwnCountryCode — leitura do perfil no servidor', () => {
  function makeClient(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    return { client: { from } as unknown as SupabaseClient, from, select, eq }
  }

  it('lê exatamente profiles.country_code do usuário informado', async () => {
    const { client, from, select, eq } = makeClient({ data: { country_code: 'BR' }, error: null })

    await expect(loadOwnCountryCode(client, 'user-uuid-1')).resolves.toBe('BR')

    expect(from).toHaveBeenCalledWith('profiles')
    expect(select).toHaveBeenCalledWith('country_code')
    expect(eq).toHaveBeenCalledWith('id', 'user-uuid-1')
  })

  it('perfil sem país → null; sem linha de perfil → null', async () => {
    await expect(loadOwnCountryCode(makeClient({ data: { country_code: null }, error: null }).client, 'u')).resolves.toBeNull()
    await expect(loadOwnCountryCode(makeClient({ data: null, error: null }).client, 'u')).resolves.toBeNull()
  })

  it('erro de consulta LANÇA (o chamador trata como fail-closed; nunca vira "elegível")', async () => {
    await expect(loadOwnCountryCode(makeClient({ data: null, error: { message: 'boom' } }).client, 'u')).rejects.toThrow(/Falha ao ler o país/)
  })
})
