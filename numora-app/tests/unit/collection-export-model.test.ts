/**
 * tests/unit/collection-export-model.test.ts
 * Etapa "5.10V.1 — Modelo Intermediário de Exportação" — testa
 * `buildCollectionExportModel` (features/collection/export-model.ts) com
 * `CollectionItem[]` fabricados, sem nenhum acesso a Supabase/rede/Blob.
 * A cobertura de SERIALIZAÇÃO (CSV) já existe em
 * tests/unit/collection-export.test.ts e continua passando inalterada —
 * este arquivo cobre só a EXTRAÇÃO/tradução dos dados para o modelo
 * neutro, que agora é a única fonte de verdade compartilhada com XLSX.
 *
 * Etapa "5.10V.2 — Excel Premium": também cobre
 * `computeCollectionExportSummary` (indicadores/distribuições da aba
 * "Resumo") — testado aqui, não em tests/unit/collection-export-xlsx.test.ts,
 * porque é lógica pura do MODELO (nunca específica de Excel), reutilizável
 * por um futuro PDF sem duplicação.
 */
import { describe, expect, it } from 'vitest'

import { buildCollectionExportModel, computeCollectionExportSummary } from '@/features/collection/export-model'
import type { CollectionItem, CollectionItemUnit } from '@/features/collection/types'

let unitCounter = 0
let itemCounter = 0

function makeUnit(overrides: Partial<CollectionItemUnit> = {}): CollectionItemUnit {
  unitCounter += 1
  return {
    id: `unit-${unitCounter}`,
    collectionItemId: 'item-1',
    gradeId: null,
    gradeLabel: null,
    gradeScale: null,
    status: 'in_collection',
    rating: null,
    isPrimary: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    purchaseId: null,
    unitCost: null,
    costOrigin: 'auto',
    costType: 'unknown',
    images: [],
    ...overrides,
  }
}

function makeItem(overrides: Partial<CollectionItem> = {}): CollectionItem {
  itemCounter += 1
  return {
    id: `item-${itemCounter}`,
    userId: 'user-1',
    purchaseId: null,
    countryCode: null,
    countryName: null,
    year: null,
    denomination: null,
    mint: null,
    metalCode: null,
    secondaryMetalCode: null,
    grossWeightG: null,
    purity: null,
    faceValue: null,
    quantity: 1,
    unitCostOverride: null,
    description: null,
    location: null,
    tags: null,
    mintage: null,
    history: null,
    trivia: null,
    catalogReferences: null,
    createdAt: '2024-03-05T10:00:00.000Z',
    updatedAt: '2024-03-05T10:00:00.000Z',
    deletedAt: null,
    countryDisplayName: null,
    countryFlagEmoji: null,
    metalName: null,
    secondaryMetalName: null,
    purchase: null,
    units: [makeUnit()],
    isPublicInPassport: false,
    isPhotoPublic: false,
    labelCode: null,
    ...overrides,
  }
}

describe('buildCollectionExportModel — transformação correta', () => {
  it('extrai identificação/composição em forma NEUTRA (number continua number, nunca string)', () => {
    const item = makeItem({
      countryDisplayName: 'Brasil',
      year: 1998,
      denomination: '1 Real',
      mint: 'Casa da Moeda',
      labelCode: 'NMR-0000001',
      quantity: 2,
      metalName: 'Aço inoxidável',
      grossWeightG: 7.55,
      purity: 0.999,
      faceValue: 1,
      mintage: '500000000',
    })
    const [row] = buildCollectionExportModel([item])

    expect(row.country).toBe('Brasil')
    expect(row.year).toBe(1998)
    expect(typeof row.year).toBe('number')
    expect(row.denomination).toBe('1 Real')
    expect(row.mint).toBe('Casa da Moeda')
    expect(row.labelCode).toBe('NMR-0000001')
    expect(row.quantity).toBe(2)
    expect(row.metal).toBe('Aço inoxidável')
    expect(row.grossWeightG).toBe(7.55)
    expect(typeof row.grossWeightG).toBe('number')
    expect(row.purity).toBe(0.999)
    expect(row.faceValue).toBe(1)
    expect(row.mintage).toBe('500000000')
  })

  it('extrai aquisição (data ISO continua string ISO, nunca já formatada)', () => {
    const item = makeItem({
      location: 'Cofre de casa',
      purchase: { totalPrice: 150, purchaseDate: '2023-06-15', sellerName: 'Numismática ABC', notes: 'Comprado em feira' },
    })
    const [row] = buildCollectionExportModel([item])

    expect(row.purchaseDate).toBe('2023-06-15')
    expect(row.seller).toBe('Numismática ABC')
    expect(row.location).toBe('Cofre de casa')
    expect(row.notes).toBe('Comprado em feira')
  })

  it('custo: exemplar único com unitCost conhecido — totalCost/costPerUnit continuam number, origem/tipo traduzidos', () => {
    const item = makeItem({
      units: [makeUnit({ unitCost: 200, costOrigin: 'manual', costType: 'purchase' })],
    })
    const [row] = buildCollectionExportModel([item])

    expect(row.totalCost).toBe(200)
    expect(typeof row.totalCost).toBe('number')
    expect(row.costPerUnit).toBe(200)
    expect(row.costOrigin).toBe('Manual')
    expect(row.costType).toBe('Compra')
  })

  it('custo desconhecido (unitCost null): totalCost/costPerUnit são null — NUNCA 0 (custo desconhecido != custo zero real)', () => {
    const item = makeItem({ units: [makeUnit({ unitCost: null })] })
    const [row] = buildCollectionExportModel([item])

    expect(row.totalCost).toBeNull()
    expect(row.costPerUnit).toBeNull()
  })

  it('exemplares com custo diferente (não uniforme): totalCost soma, mas origem/tipo ficam null', () => {
    const item = makeItem({
      units: [
        makeUnit({ id: 'u1', unitCost: 100, isPrimary: true, costOrigin: 'auto', costType: 'purchase' }),
        makeUnit({ id: 'u2', unitCost: 300, isPrimary: false, costOrigin: 'manual', costType: 'gift' }),
      ],
    })
    const [row] = buildCollectionExportModel([item])

    expect(row.totalCost).toBe(400)
    expect(row.costPerUnit).toBe(200)
    expect(row.costOrigin).toBeNull()
    expect(row.costType).toBeNull()
  })

  it('exemplar (grade/status/rating/principal) reflete o EXEMPLAR PRINCIPAL — status já traduzido para PT-BR', () => {
    const item = makeItem({
      units: [makeUnit({ gradeLabel: 'MS', gradeScale: 'Sheldon', status: 'for_sale', rating: 4, isPrimary: true })],
    })
    const [row] = buildCollectionExportModel([item])

    expect(row.grade).toBe('MS')
    expect(row.gradeScale).toBe('Sheldon')
    expect(row.status).toBe('Disponível para venda')
    expect(row.rating).toBe(4)
    expect(row.isPrimary).toBe(true)
  })

  it('tags/catalogReferences permanecem ARRAY (nunca já unidos em string — isso é decisão da camada CSV/XLSX)', () => {
    const item = makeItem({
      tags: ['comemorativa', 'prata'],
      catalogReferences: [
        { catalog: 'KM', code: '649' },
        { catalog: 'Numista', code: 'N#12345' },
      ],
    })
    const [row] = buildCollectionExportModel([item])

    expect(Array.isArray(row.tags)).toBe(true)
    expect(row.tags).toEqual(['comemorativa', 'prata'])
    expect(Array.isArray(row.catalogReferences)).toBe(true)
    expect(row.catalogReferences).toEqual([
      { catalog: 'KM', code: '649' },
      { catalog: 'Numista', code: 'N#12345' },
    ])
  })

  it('createdAt permanece string ISO (nunca já formatada) — quem formata é a camada de saída', () => {
    const item = makeItem({ createdAt: '2024-03-05T10:00:00.000Z' })
    const [row] = buildCollectionExportModel([item])
    expect(row.createdAt).toBe('2024-03-05T10:00:00.000Z')
  })
})

describe('buildCollectionExportModel — campos proibidos ausentes', () => {
  it('nenhum campo do modelo é id interno, user_id, ou dado de mercado/patrimônio', () => {
    const item = makeItem()
    const [row] = buildCollectionExportModel([item])
    const keys = Object.keys(row)

    expect(keys).not.toContain('id')
    expect(keys).not.toContain('userId')
    expect(keys).not.toContain('purchaseId')
    expect(keys).not.toContain('user_id')
    for (const forbidden of ['marketValue', 'netWorth', 'profit', 'loss', 'valuation', 'currency']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('buildCollectionExportModel — coleção vazia / 1 item / múltiplos itens', () => {
  it('coleção vazia devolve array vazio', () => {
    expect(buildCollectionExportModel([])).toEqual([])
  })

  it('1 item devolve exatamente 1 linha', () => {
    expect(buildCollectionExportModel([makeItem()])).toHaveLength(1)
  })

  it('múltiplos itens devolvem uma linha por item, na mesma ordem', () => {
    const items = [makeItem({ denomination: 'A' }), makeItem({ denomination: 'B' }), makeItem({ denomination: 'C' })]
    const rows = buildCollectionExportModel(items)

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.denomination)).toEqual(['A', 'B', 'C'])
  })

  it('campos opcionais ausentes (sem compra, sem tags, sem exemplares) nunca lançam erro', () => {
    const item = makeItem({ units: [] })
    expect(() => buildCollectionExportModel([item])).not.toThrow()

    const [row] = buildCollectionExportModel([item])
    expect(row.purchaseDate).toBeNull()
    expect(row.totalCost).toBeNull()
    expect(row.grade).toBeNull()
    expect(row.status).toBeNull()
    expect(row.tags).toEqual([])
    expect(row.catalogReferences).toEqual([])
  })
})

describe('computeCollectionExportSummary — distinção itens x exemplares', () => {
  it('totalItems = nº de linhas do modelo; totalUnits = soma de quantity — nunca confundir as duas', () => {
    const items = [
      makeItem({ quantity: 1 }),
      makeItem({ quantity: 3 }),
      makeItem({ quantity: 2 }),
    ]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))

    expect(summary.totalItems).toBe(3)
    expect(summary.totalUnits).toBe(6)
  })
})

describe('computeCollectionExportSummary — países/anos representados', () => {
  it('conta valores DISTINTOS não-nulos', () => {
    const items = [
      makeItem({ countryDisplayName: 'Brasil', year: 1998 }),
      makeItem({ countryDisplayName: 'Brasil', year: 2001 }),
      makeItem({ countryDisplayName: 'Portugal', year: 1998 }),
      makeItem({ countryDisplayName: null, year: null }),
    ]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))

    expect(summary.countriesRepresented).toBe(2)
    expect(summary.yearsRepresented).toBe(2)
  })
})

describe('computeCollectionExportSummary — aquisições', () => {
  it('compras registradas = itens com purchaseDate conhecido; primeira/última aquisição por data', () => {
    const items = [
      makeItem({ purchase: { totalPrice: 10, purchaseDate: '2020-05-10', sellerName: null, notes: null } }),
      makeItem({ purchase: { totalPrice: 10, purchaseDate: '2023-01-01', sellerName: null, notes: null } }),
      makeItem({ purchase: null }),
    ]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))

    expect(summary.registeredPurchases).toBe(2)
    expect(summary.firstAcquisitionDate).toBe('2020-05-10')
    expect(summary.lastAcquisitionDate).toBe('2023-01-01')
  })

  it('nenhuma compra registrada: datas ficam null (nunca uma data inventada)', () => {
    const summary = computeCollectionExportSummary(buildCollectionExportModel([makeItem({ purchase: null })]))
    expect(summary.registeredPurchases).toBe(0)
    expect(summary.firstAcquisitionDate).toBeNull()
    expect(summary.lastAcquisitionDate).toBeNull()
  })
})

describe('computeCollectionExportSummary — custo total conhecido', () => {
  it('soma o custo de todos os itens com custo conhecido', () => {
    const items = [
      makeItem({ units: [makeUnit({ unitCost: 100 })] }),
      makeItem({ units: [makeUnit({ unitCost: 250 })] }),
    ]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))
    expect(summary.totalKnownCost).toBe(350)
  })

  it('nenhum item com custo conhecido: totalKnownCost é null — NUNCA "0" (custo desconhecido != custo real zero)', () => {
    const items = [makeItem({ units: [makeUnit({ unitCost: null })] }), makeItem({ units: [makeUnit({ unitCost: null })] })]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))
    expect(summary.totalKnownCost).toBeNull()
  })

  it('soma só os itens com custo conhecido, ignorando os desconhecidos (nunca trata desconhecido como 0 na soma final)', () => {
    const items = [makeItem({ units: [makeUnit({ unitCost: 100 })] }), makeItem({ units: [makeUnit({ unitCost: null })] })]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))
    expect(summary.totalKnownCost).toBe(100)
  })
})

describe('computeCollectionExportSummary — distribuições', () => {
  it('por país/metal: contadas por ITEM (mesma convenção de lib/stats/collection-stats.ts)', () => {
    const items = [
      makeItem({ countryDisplayName: 'Brasil', metalName: 'Prata' }),
      makeItem({ countryDisplayName: 'Brasil', metalName: 'Ouro' }),
      makeItem({ countryDisplayName: 'Portugal', metalName: 'Prata' }),
    ]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))

    expect(summary.countryDistribution).toEqual(
      expect.arrayContaining([
        { label: 'Brasil', count: 2 },
        { label: 'Portugal', count: 1 },
      ]),
    )
    expect(summary.metalDistribution).toEqual(
      expect.arrayContaining([
        { label: 'Prata', count: 2 },
        { label: 'Ouro', count: 1 },
      ]),
    )
  })

  it('por status: reflete o exemplar principal de cada item (mesma limitação documentada no modelo)', () => {
    const items = [
      makeItem({ units: [makeUnit({ status: 'in_collection', isPrimary: true })] }),
      makeItem({ units: [makeUnit({ status: 'for_sale', isPrimary: true })] }),
    ]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))

    expect(summary.statusDistribution).toEqual(
      expect.arrayContaining([
        { label: 'Na coleção', count: 1 },
        { label: 'Disponível para venda', count: 1 },
      ]),
    )
  })

  it('por década: agrupa anos em décadas ("Década de 1990")', () => {
    const items = [makeItem({ year: 1994 }), makeItem({ year: 1998 }), makeItem({ year: 2005 })]
    const summary = computeCollectionExportSummary(buildCollectionExportModel(items))

    expect(summary.decadeDistribution).toEqual(
      expect.arrayContaining([
        { label: 'Década de 1990', count: 2 },
        { label: 'Década de 2000', count: 1 },
      ]),
    )
  })

  it('distribuição vazia (nenhum dado) é um array vazio — nunca lança erro', () => {
    const summary = computeCollectionExportSummary([])
    expect(summary.countryDistribution).toEqual([])
    expect(summary.metalDistribution).toEqual([])
    expect(summary.statusDistribution).toEqual([])
    expect(summary.decadeDistribution).toEqual([])
  })
})

describe('computeCollectionExportSummary — coleção vazia', () => {
  it('nenhuma exceção, todos os totais em zero/null', () => {
    const summary = computeCollectionExportSummary([])
    expect(summary.totalItems).toBe(0)
    expect(summary.totalUnits).toBe(0)
    expect(summary.countriesRepresented).toBe(0)
    expect(summary.yearsRepresented).toBe(0)
    expect(summary.registeredPurchases).toBe(0)
    expect(summary.totalKnownCost).toBeNull()
  })
})
