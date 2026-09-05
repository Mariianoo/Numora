/**
 * features/labels/layout-constants.ts
 * Etapa "F4 — Numora Labels" — geometria física da folha A4, fonte ÚNICA
 * usada tanto pela pré-visualização (HTML/CSS) quanto pelo PDF (`jsPDF`),
 * exatamente como a auditoria pediu ("a mesma definição de dados/layout
 * deve alimentar ambos"). Todas as medidas em milímetros — nunca pixels de
 * tela (o PDF preserva dimensões físicas reais).
 *
 * CORREÇÃO EM RELAÇÃO AOS "PARÂMETROS INICIAIS" DA AUDITORIA/APROVAÇÃO:
 * o tamanho da etiqueta (99,1 × 38,1 mm) e a quantidade por folha (14 = 2
 * colunas × 7 linhas) são a decisão final do owner e não foram alterados.
 * Mas os valores de "margem externa: 10mm / gutter: 3mm" citados como
 * parâmetros iniciais não são fisicamente compatíveis com esse tamanho:
 * 2 colunas de 99,1mm + gutter de 3mm + 2 margens de 10mm = 221,2mm, mais
 * largo que a própria folha A4 (210mm). Os valores abaixo foram recalculados
 * para caber exatamente na A4 com o tamanho/quantidade já decididos,
 * mantendo um gutter vertical de 3mm (compatível na vertical) e reduzindo
 * margem lateral/gutter horizontal ao mínimo necessário para caber:
 *   Horizontal: 2 × 99,1 + 2 × margem + gutter = 210
 *   Vertical:   7 × 38,1 + 6 × 3 (gutter) + 2 × margem = 297
 */

export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297

export const LABEL_WIDTH_MM = 99.1
export const LABEL_HEIGHT_MM = 38.1

export const LABELS_PER_ROW = 2
export const LABELS_PER_COLUMN = 7
export const LABELS_PER_PAGE = LABELS_PER_ROW * LABELS_PER_COLUMN

export const VERTICAL_GUTTER_MM = 3

/**
 * Margem/gutter horizontal recalculados para caber exatamente 2 colunas de
 * 99,1mm na largura de 210mm da A4 — ver nota de correção no topo do
 * arquivo. Resultado: ~5mm de margem lateral, ~1,8mm de gutter entre as 2
 * colunas (tolerância de corte apertada — documentado como limitação
 * conhecida no relatório desta etapa, não escondido).
 */
export const HORIZONTAL_GUTTER_MM = A4_WIDTH_MM - LABELS_PER_ROW * LABEL_WIDTH_MM - 2 * 5
export const SIDE_MARGIN_MM = 5

/** Margem topo/base recalculada para caber exatamente 7 linhas de 38,1mm com 3mm de gutter entre elas. */
export const TOP_BOTTOM_MARGIN_MM =
  (A4_HEIGHT_MM - LABELS_PER_COLUMN * LABEL_HEIGHT_MM - (LABELS_PER_COLUMN - 1) * VERTICAL_GUTTER_MM) / 2

export const QR_MIN_SIZE_MM = 18
/** Nível de correção de erro do QR — 'M' (padrão da lib) já é adequado para o tamanho/uso aqui; 'Q' fica disponível se a impressão em papel comum se mostrar sensível a manchas/dobras. */
export const QR_ERROR_CORRECTION: 'M' | 'Q' = 'M'
/** Quiet zone maior que o já usado no Passport (`margin: 1`, só tela) — impressão física se beneficia de mais respiro ao redor do QR. */
export const QR_QUIET_ZONE_MODULES = 3

export interface LabelPosition {
  /** Distância do canto superior esquerdo da folha até o canto superior esquerdo desta etiqueta, em mm. */
  xMm: number
  yMm: number
}

/** Posição física (mm) da N-ésima etiqueta (0-indexed) dentro de UMA página A4. */
export function labelPositionOnPage(indexOnPage: number): LabelPosition {
  const row = Math.floor(indexOnPage / LABELS_PER_ROW)
  const col = indexOnPage % LABELS_PER_ROW

  return {
    xMm: SIDE_MARGIN_MM + col * (LABEL_WIDTH_MM + HORIZONTAL_GUTTER_MM),
    yMm: TOP_BOTTOM_MARGIN_MM + row * (LABEL_HEIGHT_MM + VERTICAL_GUTTER_MM),
  }
}

/** Divide uma lista de etiquetas em páginas de `LABELS_PER_PAGE` — nunca uma etiqueta parcial/cortada entre páginas. */
export function paginateLabels<T>(items: T[]): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += LABELS_PER_PAGE) {
    pages.push(items.slice(i, i + LABELS_PER_PAGE))
  }
  return pages
}
