import { describe, expect, it } from 'vitest'

import { canPublishPhoto, getPrimaryUnit } from '@/features/collection/aggregate'
import type { CollectionItem, CollectionItemUnit } from '@/features/collection/types'

function makeUnit(overrides: Partial<CollectionItemUnit>): CollectionItemUnit {
  return {
    id: 'unit-1',
    collectionItemId: 'item-1',
    gradeId: null,
    gradeLabel: null,
    gradeScale: null,
    status: 'in_collection',
    rating: null,
    isPrimary: false,
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

function makeItem(overrides: Partial<CollectionItem>): CollectionItem {
  return {
    id: 'item-1',
    userId: 'user-1',
    purchaseId: null,
    countryCode: 'BR',
    countryName: 'Brasil',
    year: 2000,
    denomination: '10 Centavos',
    mint: null,
    metalCode: 'CU',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    countryDisplayName: 'Brasil',
    countryFlagEmoji: '🇧🇷',
    metalName: 'Cobre',
    secondaryMetalName: null,
    purchase: null,
    units: [],
    isPublicInPassport: false,
    isPhotoPublic: false,
    labelCode: null,
    ...overrides,
  }
}

describe('getPrimaryUnit', () => {
  it('retorna o exemplar marcado isPrimary, mesmo que não seja o primeiro do array', () => {
    const secondary = makeUnit({ id: 'unit-a', isPrimary: false })
    const primary = makeUnit({ id: 'unit-b', isPrimary: true })
    const item = makeItem({ units: [secondary, primary] })
    expect(getPrimaryUnit(item)?.id).toBe('unit-b')
  })

  it('fallback defensivo: nenhum isPrimary marcado → usa units[0]', () => {
    const first = makeUnit({ id: 'unit-a', isPrimary: false })
    const second = makeUnit({ id: 'unit-b', isPrimary: false })
    const item = makeItem({ units: [first, second] })
    expect(getPrimaryUnit(item)?.id).toBe('unit-a')
  })

  it('retorna null quando o item não tem nenhum exemplar', () => {
    expect(getPrimaryUnit(makeItem({ units: [] }))).toBeNull()
  })
})

describe('canPublishPhoto', () => {
  const unitWithFrontPhoto = makeUnit({ id: 'unit-1', isPrimary: true, images: [{ kind: 'front', storagePath: 'u1/f.webp' }] })
  const unitWithoutFrontPhoto = makeUnit({ id: 'unit-1', isPrimary: true, images: [{ kind: 'back', storagePath: 'u1/b.webp' }] })
  const unitWithNoPhotos = makeUnit({ id: 'unit-1', isPrimary: true, images: [] })

  it('permite publicar quando visibilidade = "all" e o exemplar principal tem foto de frente', () => {
    const item = makeItem({ units: [unitWithFrontPhoto], isPublicInPassport: false })
    expect(canPublishPhoto(item, 'all')).toBe(true)
  })

  it('permite publicar quando visibilidade = "selected" E o item está marcado isPublicInPassport', () => {
    const item = makeItem({ units: [unitWithFrontPhoto], isPublicInPassport: true })
    expect(canPublishPhoto(item, 'selected')).toBe(true)
  })

  it('proíbe quando visibilidade = "selected" mas o item NÃO está marcado isPublicInPassport', () => {
    const item = makeItem({ units: [unitWithFrontPhoto], isPublicInPassport: false })
    expect(canPublishPhoto(item, 'selected')).toBe(false)
  })

  it('proíbe quando visibilidade = "none", mesmo com foto de frente disponível', () => {
    const item = makeItem({ units: [unitWithFrontPhoto], isPublicInPassport: true })
    expect(canPublishPhoto(item, 'none')).toBe(false)
  })

  it('proíbe quando visibilidade é null (perfil ainda não carregado)', () => {
    const item = makeItem({ units: [unitWithFrontPhoto] })
    expect(canPublishPhoto(item, null)).toBe(false)
  })

  it('proíbe quando o exemplar principal não tem foto "front" (só "back", por exemplo)', () => {
    const item = makeItem({ units: [unitWithoutFrontPhoto] })
    expect(canPublishPhoto(item, 'all')).toBe(false)
  })

  it('proíbe quando o exemplar principal não tem nenhuma foto', () => {
    const item = makeItem({ units: [unitWithNoPhotos] })
    expect(canPublishPhoto(item, 'all')).toBe(false)
  })

  it('só considera a foto do exemplar PRINCIPAL — foto de frente num exemplar secundário não habilita a publicação', () => {
    const secondaryWithFront = makeUnit({ id: 'unit-2', isPrimary: false, images: [{ kind: 'front', storagePath: 'u2/f.webp' }] })
    const primaryWithoutFront = makeUnit({ id: 'unit-1', isPrimary: true, images: [] })
    const item = makeItem({ units: [primaryWithoutFront, secondaryWithFront] })
    expect(canPublishPhoto(item, 'all')).toBe(false)
  })

  it('proíbe quando o item não tem nenhum exemplar', () => {
    const item = makeItem({ units: [] })
    expect(canPublishPhoto(item, 'all')).toBe(false)
  })
})
