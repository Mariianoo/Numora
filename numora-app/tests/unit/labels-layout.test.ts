/**
 * tests/unit/labels-layout.test.ts
 * Etapa "F4 — Numora Labels" — `buildLabelData`/`getLabelLines`
 * (features/labels/label-layout.ts), 100% puras. Cobre a regra central:
 * campo ausente nunca vira "—"/espaço reservado, só é omitido.
 */
import { describe, expect, it } from 'vitest'

import { buildLabelData, getLabelLines, getPrintSafeLabelLines } from '@/features/labels/label-layout'
import { buildPassportItemUrl } from '@/features/labels/qr'
import type { CollectionItem, CollectionItemUnit } from '@/features/collection/types'

function makeUnit(overrides: Partial<CollectionItemUnit> = {}): CollectionItemUnit {
  return {
    id: 'unit-1',
    collectionItemId: 'item-1',
    gradeId: null,
    gradeLabel: null,
    gradeScale: null,
    status: 'in_collection',
    rating: null,
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    purchaseId: null,
    unitCost: null,
    costOrigin: 'auto',
    costType: 'unknown',
    images: [],
    ...overrides,
  }
}

function makeItem(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 'item-1',
    userId: 'user-1',
    purchaseId: null,
    countryCode: 'BR',
    countryName: 'Brasil',
    year: 1979,
    denomination: '1 Cruzeiro',
    mint: null,
    metalCode: 'CU',
    secondaryMetalCode: null,
    grossWeightG: 5.2,
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    countryDisplayName: 'Brasil',
    countryFlagEmoji: '🇧🇷',
    metalName: 'Bronze',
    secondaryMetalName: null,
    purchase: null,
    units: [makeUnit()],
    isPublicInPassport: false,
    isPhotoPublic: false,
    labelCode: null,
    ...overrides,
  }
}

const OPTIONS = { financialDisplay: 'none' as const, origin: 'https://numora.app', ownerUsername: 'colecionador' }

describe('buildPassportItemUrl', () => {
  it('usa o UUID interno do item, nunca o label_code', () => {
    const url = buildPassportItemUrl('https://numora.app', 'colecionador', 'item-1')
    expect(url).toBe('https://numora.app/passport/colecionador/coin/item-1')
    expect(url).not.toContain('NMR-')
  })
})

describe('buildLabelData', () => {
  it('monta os campos a partir de um item completo', () => {
    const item = makeItem({ labelCode: 'NMR-0000001' })
    const data = buildLabelData(item, OPTIONS)

    expect(data.labelCode).toBe('NMR-0000001')
    expect(data.denomination).toBe('1 Cruzeiro')
    expect(data.countryName).toBe('Brasil')
    expect(data.weightG).toBe(5.2)
    expect(data.qrTargetUrl).toBe('https://numora.app/passport/colecionador/coin/item-1')
  })

  it('labelCode é null antes da primeira geração', () => {
    const data = buildLabelData(makeItem({ labelCode: null }), OPTIONS)
    expect(data.labelCode).toBeNull()
  })

  it('usa o exemplar PRIMARY (não units[0]) para conservação e valor de compra', () => {
    const secondary = makeUnit({ id: 'unit-a', isPrimary: false, gradeLabel: 'Secundário' })
    const primary = makeUnit({ id: 'unit-b', isPrimary: true, gradeLabel: 'MS-63', unitCost: 42.5 })
    const item = makeItem({ units: [secondary, primary] })

    const data = buildLabelData(item, { ...OPTIONS, financialDisplay: 'purchase' })
    expect(data.gradeLabel).toBe('MS-63')
    expect(data.purchaseValue).toBe(42.5)
  })

  it('financialDisplay="none" nunca popula purchaseValue, mesmo com custo real', () => {
    const item = makeItem({ units: [makeUnit({ unitCost: 100 })] })
    const data = buildLabelData(item, { ...OPTIONS, financialDisplay: 'none' })
    expect(data.purchaseValue).toBeNull()
  })

  it('financialDisplay="purchase" sem custo conhecido no exemplar cai para o total da compra', () => {
    const item = makeItem({
      units: [makeUnit({ unitCost: null })],
      purchase: { totalPrice: 30, purchaseDate: null, sellerName: null, notes: null },
    })
    const data = buildLabelData(item, { ...OPTIONS, financialDisplay: 'purchase' })
    expect(data.purchaseValue).toBe(30)
  })
})

describe('getLabelLines', () => {
  it('campos ausentes nunca viram "—" — simplesmente não aparecem', () => {
    const data = buildLabelData(
      makeItem({
        denomination: null,
        countryDisplayName: null,
        countryFlagEmoji: null,
        countryCode: null,
        year: null,
        metalName: null,
        secondaryMetalName: null,
        grossWeightG: null,
        description: null,
        units: [],
      }),
      OPTIONS,
    )

    const lines = getLabelLines(data)
    expect(lines.title).toBeNull()
    expect(lines.originLine).toBeNull()
    expect(lines.metalLine).toBeNull()
    expect(lines.detailLines).toEqual([])

    const serialized = JSON.stringify(lines)
    expect(serialized).not.toContain('—')
  })

  it('monta originLine só com as partes que existem (país sem ano, ano sem país)', () => {
    const onlyCountry = getLabelLines(buildLabelData(makeItem({ year: null }), OPTIONS))
    expect(onlyCountry.originLine).toBe('🇧🇷 Brasil')

    const onlyYear = getLabelLines(
      buildLabelData(makeItem({ countryDisplayName: null, countryFlagEmoji: null, countryCode: null }), OPTIONS),
    )
    expect(onlyYear.originLine).toBe('1979')
  })

  it('metalLine combina metal + segundo metal só quando ambos existem', () => {
    const bimetallic = getLabelLines(buildLabelData(makeItem({ secondaryMetalName: 'Níquel' }), OPTIONS))
    expect(bimetallic.metalLine).toBe('Bronze + Níquel')

    const single = getLabelLines(buildLabelData(makeItem({ secondaryMetalName: null }), OPTIONS))
    expect(single.metalLine).toBe('Bronze')
  })

  it('detailLines inclui peso, conservação e valor de compra na ordem esperada, só quando presentes', () => {
    const item = makeItem({
      grossWeightG: 5.2,
      units: [makeUnit({ gradeLabel: 'MS-63', unitCost: 42.5 })],
      description: 'Presente de família',
    })
    const lines = getLabelLines(buildLabelData(item, { ...OPTIONS, financialDisplay: 'purchase' }))

    expect(lines.detailLines).toEqual(['5,20 g', 'MS-63', 'R$ 42,50', 'Presente de família'])
  })
})

describe('getPrintSafeLabelLines', () => {
  it('nunca inclui o emoji de bandeira na originLine (achado real: "1 Balboa — Panamá — 1947" quebrado no PDF)', () => {
    const item = makeItem({
      countryDisplayName: 'Panamá',
      countryFlagEmoji: '🇵🇦',
      countryCode: 'PA',
      year: 1947,
      denomination: '1 Balboa',
    })
    const lines = getPrintSafeLabelLines(buildLabelData(item, OPTIONS))

    expect(lines.originLine).toBe('PANAMÁ · 1947')
    expect(lines.originLine).not.toContain('🇵🇦')
    expect(/^[\x00-\xFF]*$/.test(lines.originLine ?? '')).toBe(true)
  })

  it('mantém acentos latinos (WinAnsiEncoding cobre Latin-1)', () => {
    const item = makeItem({ countryDisplayName: 'São Tomé e Príncipe', countryFlagEmoji: '🇸🇹', year: 2000 })
    const lines = getPrintSafeLabelLines(buildLabelData(item, OPTIONS))

    expect(lines.originLine).toBe('SÃO TOMÉ E PRÍNCIPE · 2000')
  })

  it('cai para countryCode em maiúsculas quando não há countryName', () => {
    const item = makeItem({ countryDisplayName: null, countryFlagEmoji: null, countryCode: 'pa', year: 1947 })
    const lines = getPrintSafeLabelLines(buildLabelData(item, OPTIONS))

    expect(lines.originLine).toBe('PA · 1947')
  })

  it('título/metalLine/detailLines permanecem idênticos a getLabelLines (só originLine muda)', () => {
    const item = makeItem({ units: [makeUnit({ gradeLabel: 'MS-63' })] })
    const data = buildLabelData(item, OPTIONS)

    const normal = getLabelLines(data)
    const printSafe = getPrintSafeLabelLines(data)

    expect(printSafe.title).toBe(normal.title)
    expect(printSafe.metalLine).toBe(normal.metalLine)
    expect(printSafe.detailLines).toEqual(normal.detailLines)
  })

  it('originLine é null quando não há país nem ano (mesma regra de getLabelLines)', () => {
    const item = makeItem({ countryDisplayName: null, countryFlagEmoji: null, countryCode: null, year: null })
    const lines = getPrintSafeLabelLines(buildLabelData(item, OPTIONS))

    expect(lines.originLine).toBeNull()
  })
})
