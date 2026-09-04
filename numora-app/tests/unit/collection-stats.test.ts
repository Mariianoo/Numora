import { describe, expect, it } from 'vitest'

import { computeCollectionStats } from '@/lib/stats/collection-stats'

describe('computeCollectionStats', () => {
  it('coleção vazia → todos os agregados zerados', () => {
    const result = computeCollectionStats([], [])
    expect(result).toEqual({ totalItems: 0, totalUnits: 0, countryCount: 0, metalCount: 0, totalInvested: 0 })
  })

  it('múltiplos itens: soma quantity para totalUnits, conta países/metais distintos', () => {
    const result = computeCollectionStats(
      [
        { quantity: 2, country_code: 'BR', metal_code: 'CU' },
        { quantity: 1, country_code: 'BR', metal_code: 'AG' },
        { quantity: 3, country_code: 'US', metal_code: 'CU' },
      ],
      [],
    )
    expect(result.totalItems).toBe(3)
    expect(result.totalUnits).toBe(6)
    expect(result.countryCount).toBe(2) // BR, US
    expect(result.metalCount).toBe(2) // CU, AG
  })

  it('country_code/metal_code null nunca conta como país/metal distinto', () => {
    const result = computeCollectionStats(
      [
        { quantity: 1, country_code: null, metal_code: null },
        { quantity: 1, country_code: 'BR', metal_code: 'AG' },
      ],
      [],
    )
    expect(result.countryCount).toBe(1)
    expect(result.metalCount).toBe(1)
  })

  it('totalInvested soma purchases.total_price diretamente (nunca deriva de collection_items)', () => {
    const result = computeCollectionStats(
      [{ quantity: 5, country_code: 'BR', metal_code: 'CU' }], // mesma purchase, vários exemplares — não deveria inflar o total
      [{ total_price: 150.5 }, { total_price: 49.5 }],
    )
    expect(result.totalInvested).toBe(200)
  })

  it('total_price como string (vindo do PostgREST em alguns drivers) é convertido para número', () => {
    const result = computeCollectionStats([], [{ total_price: '10.5' as unknown as number }])
    expect(result.totalInvested).toBe(10.5)
  })
})
