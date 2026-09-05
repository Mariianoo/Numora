/**
 * tests/unit/labels-layout-constants.test.ts
 * Etapa "F4 — Numora Labels" — geometria da folha A4
 * (features/labels/layout-constants.ts): a grade de 14 etiquetas por
 * página cabe fisicamente dentro da A4, e a paginação nunca corta uma
 * etiqueta entre páginas.
 */
import { describe, expect, it } from 'vitest'

import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  LABELS_PER_COLUMN,
  LABELS_PER_PAGE,
  LABELS_PER_ROW,
  QR_MIN_SIZE_MM,
  labelPositionOnPage,
  paginateLabels,
} from '@/features/labels/layout-constants'

describe('geometria da folha A4', () => {
  it('14 etiquetas por página (2 colunas × 7 linhas), conforme aprovado', () => {
    expect(LABELS_PER_ROW).toBe(2)
    expect(LABELS_PER_COLUMN).toBe(7)
    expect(LABELS_PER_PAGE).toBe(14)
  })

  it('toda etiqueta cabe dentro da largura/altura da folha A4', () => {
    for (let i = 0; i < LABELS_PER_PAGE; i++) {
      const { xMm, yMm } = labelPositionOnPage(i)
      expect(xMm).toBeGreaterThanOrEqual(0)
      expect(yMm).toBeGreaterThanOrEqual(0)
      expect(xMm + LABEL_WIDTH_MM).toBeLessThanOrEqual(A4_WIDTH_MM)
      expect(yMm + LABEL_HEIGHT_MM).toBeLessThanOrEqual(A4_HEIGHT_MM)
    }
  })

  it('nenhuma etiqueta se sobrepõe a outra na mesma página', () => {
    const positions = Array.from({ length: LABELS_PER_PAGE }, (_, i) => labelPositionOnPage(i))
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]
        const b = positions[j]
        const overlapsX = a.xMm < b.xMm + LABEL_WIDTH_MM && b.xMm < a.xMm + LABEL_WIDTH_MM
        const overlapsY = a.yMm < b.yMm + LABEL_HEIGHT_MM && b.yMm < a.yMm + LABEL_HEIGHT_MM
        expect(overlapsX && overlapsY).toBe(false)
      }
    }
  })

  it('QR mínimo (18mm) cabe dentro da altura da etiqueta (38.1mm) com folga', () => {
    expect(QR_MIN_SIZE_MM).toBeLessThan(LABEL_HEIGHT_MM)
  })
})

describe('paginateLabels', () => {
  it('nunca corta uma etiqueta entre páginas — cada página tem no máximo LABELS_PER_PAGE itens', () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`)
    const pages = paginateLabels(items)

    expect(pages).toHaveLength(3) // 14 + 14 + 2
    expect(pages[0]).toHaveLength(14)
    expect(pages[1]).toHaveLength(14)
    expect(pages[2]).toHaveLength(2)
    expect(pages.flat()).toEqual(items)
  })

  it('lista vazia produz zero páginas', () => {
    expect(paginateLabels([])).toEqual([])
  })

  it('lista menor que uma página inteira produz exatamente 1 página', () => {
    expect(paginateLabels(['a', 'b'])).toEqual([['a', 'b']])
  })
})
