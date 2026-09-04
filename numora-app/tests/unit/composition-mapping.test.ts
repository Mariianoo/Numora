import { describe, expect, it } from 'vitest'

import { parseCompositionResponse, synthesizeLegacyComposition } from '@/features/coin-composition/composition-mapping'

describe('synthesizeLegacyComposition', () => {
  it('composição vazia (nenhum campo legado preenchido) → parts: []', () => {
    const result = synthesizeLegacyComposition({ id: 'item-1', metal_code: null, secondary_metal_code: null, purity: null })
    expect(result.parts).toEqual([])
    expect(result.legacy).toEqual({ metalCode: null, secondaryMetalCode: null, purity: null })
  })

  it('monometálica com pureza conhecida → 1 parte "body", percentage = purity * 100', () => {
    const result = synthesizeLegacyComposition({
      id: 'item-2',
      metal_code: 'AG',
      secondary_metal_code: null,
      purity: 0.925,
    })
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].part).toBe('body')
    expect(result.parts[0].components).toHaveLength(1)
    expect(result.parts[0].components[0].metalCode).toBe('AG')
    expect(result.parts[0].components[0].percentage).toBeCloseTo(92.5)
  })

  it('monometálica com pureza desconhecida → percentage null (NUNCA 100 implícito)', () => {
    const result = synthesizeLegacyComposition({
      id: 'item-3',
      metal_code: 'CU',
      secondary_metal_code: null,
      purity: null,
    })
    expect(result.parts[0].components[0].percentage).toBeNull()
  })

  it('bimetálica → 1 parte "core" + 1 parte "ring", percentage SEMPRE null (nunca derivado de purity)', () => {
    const result = synthesizeLegacyComposition({
      id: 'item-4',
      metal_code: 'STEEL',
      secondary_metal_code: 'BRASS',
      // `purity` preenchido de propósito neste teste — o comportamento
      // legado documentado é NUNCA usar este valor no caso bimetálico,
      // mesmo que esteja presente (ambiguidade histórica real, ver
      // comentário do módulo).
      purity: 0.5,
    })
    expect(result.parts).toHaveLength(2)
    const core = result.parts.find((p) => p.part === 'core')
    const ring = result.parts.find((p) => p.part === 'ring')
    expect(core?.components[0].metalCode).toBe('STEEL')
    expect(core?.components[0].percentage).toBeNull()
    expect(ring?.components[0].metalCode).toBe('BRASS')
    expect(ring?.components[0].percentage).toBeNull()
    // legacy.purity ainda é espelhado no retorno (não é apagado), só nunca usado para derivar percentage.
    expect(result.legacy.purity).toBe(0.5)
  })

  it('ids sintéticos são estáveis e prefixados como "legacy-*" (nunca colidem com ids reais de banco)', () => {
    const result = synthesizeLegacyComposition({
      id: 'abc-123',
      metal_code: 'AU',
      secondary_metal_code: null,
      purity: 1,
    })
    expect(result.parts[0].id).toBe('legacy-body-abc-123')
    expect(result.parts[0].components[0].id).toBe('legacy-body-abc-123-0')
  })
})

describe('parseCompositionResponse', () => {
  const validRpcResponse = {
    collectionItemId: 'item-1',
    parts: [
      {
        id: 'part-1',
        part: 'body',
        sortOrder: 0,
        components: [{ id: 'comp-1', metalCode: 'AG', percentage: 100, sortOrder: 0 }],
      },
    ],
    legacy: { metalCode: 'AG', secondaryMetalCode: null, purity: 1 },
  }

  it('faz parse de uma resposta válida da RPC', () => {
    const result = parseCompositionResponse(validRpcResponse, 'item-1')
    expect(result.collectionItemId).toBe('item-1')
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].components[0].metalCode).toBe('AG')
    expect(result.legacy.purity).toBe(1)
  })

  it('faz parse de "composição limpa" (parts: [])', () => {
    const result = parseCompositionResponse(
      { collectionItemId: 'item-2', parts: [], legacy: { metalCode: null, secondaryMetalCode: null, purity: null } },
      'item-2',
    )
    expect(result.parts).toEqual([])
  })

  it('lança erro explícito para resposta que não é objeto', () => {
    expect(() => parseCompositionResponse(null, 'item-1')).toThrow()
    expect(() => parseCompositionResponse('string', 'item-1')).toThrow()
    expect(() => parseCompositionResponse([], 'item-1')).toThrow()
  })

  it('lança erro explícito quando "parts" não é array — nunca vira [] silenciosamente', () => {
    expect(() => parseCompositionResponse({ ...validRpcResponse, parts: 'not-an-array' }, 'item-1')).toThrow()
  })

  it('lança erro explícito quando "legacy" está ausente ou malformado', () => {
    expect(() => parseCompositionResponse({ ...validRpcResponse, legacy: null }, 'item-1')).toThrow()
    expect(() =>
      parseCompositionResponse({ ...validRpcResponse, legacy: { metalCode: 123, secondaryMetalCode: null, purity: null } }, 'item-1'),
    ).toThrow()
  })

  it('lança erro explícito quando um componente tem campo com tipo errado', () => {
    const malformed = {
      ...validRpcResponse,
      parts: [{ id: 'part-1', part: 'body', sortOrder: 0, components: [{ id: 'comp-1', metalCode: 'AG', percentage: 'cem', sortOrder: 0 }] }],
    }
    expect(() => parseCompositionResponse(malformed, 'item-1')).toThrow()
  })
})
