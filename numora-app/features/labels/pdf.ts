/**
 * features/labels/pdf.ts
 * Etapa "F4 — Numora Labels" — geração do PDF A4 via `jsPDF` (100%
 * client-side, mesmo espírito do QR/processamento de imagem já existentes
 * no projeto — nenhuma infraestrutura de servidor nova). Usa EXATAMENTE a
 * mesma geometria (`layout-constants.ts`) e a mesma composição de texto
 * (`getLabelLines`, `label-layout.ts`) que a pré-visualização HTML — nunca
 * um layout paralelo.
 *
 * Paleta de IMPRESSÃO (Cream/Navy/Gold) — deliberadamente diferente da
 * paleta de TELA do app (`app/globals.css`, dark-first): um fundo escuro
 * numa etiqueta impressa gastaria tinta e prejudicaria a leitura em papel.
 * Fundo branco (sem fill — economia de tinta), texto Navy, moldura fina em
 * Gold, símbolo Numora oficial (`public/brand/numora-symbol-reduced.png`,
 * nenhum SVG recriado) no canto.
 */
import { jsPDF } from 'jspdf'
import type { LabelData } from './types'
import { getPrintSafeLabelLines } from './label-layout'
import { generateLabelQrDataUrl } from './qr'
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  QR_MIN_SIZE_MM,
  labelPositionOnPage,
  paginateLabels,
} from './layout-constants'

const NAVY: [number, number, number] = [11, 31, 59]
const GOLD: [number, number, number] = [212, 175, 55]

const SYMBOL_PATH = '/brand/numora-symbol-reduced.png'
/**
 * O PNG oficial em `public/brand/` tem ~560KB (alta resolução, pensado para
 * telas) — embutido no PDF sem redimensionar, cada etiqueta adicionaria
 * esses ~560KB inteiros ao arquivo, mesmo desenhado a 4mm (achado real em
 * QA manual: um PDF de 1 única etiqueta chegou a 4,3MB). Redesenhado aqui
 * num canvas pequeno ANTES de embutir — 128px já é generoso para 4mm a
 * qualquer resolução de impressão doméstica — sem gerar nenhum asset novo
 * em disco nem recriar o logo (mesmo arquivo oficial, só reamostrado em
 * memória para o PDF).
 */
const SYMBOL_RASTER_SIZE_PX = 128
let cachedSymbolDataUrl: Promise<string> | null = null

function loadSymbolDataUrl(): Promise<string> {
  cachedSymbolDataUrl ??= new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SYMBOL_RASTER_SIZE_PX
      canvas.height = SYMBOL_RASTER_SIZE_PX
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Falha ao preparar o símbolo Numora.'))
        return
      }
      ctx.drawImage(image, 0, 0, SYMBOL_RASTER_SIZE_PX, SYMBOL_RASTER_SIZE_PX)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('Falha ao carregar o símbolo Numora.'))
    image.src = SYMBOL_PATH
  })
  return cachedSymbolDataUrl
}

const QR_SIZE_MM = QR_MIN_SIZE_MM + 4
const PADDING_MM = 3
const SYMBOL_SIZE_MM = 3.5

/**
 * Etapa "F5 — Labels PDF fix" — remove qualquer caractere fora de
 * WinAnsiEncoding/Latin-1 (código > 0xFF) ANTES de desenhar. Rede de
 * segurança além de `getPrintSafeLabelLines` (que já resolve o caso
 * conhecido da bandeira): cobre também qualquer emoji/símbolo que
 * eventualmente apareça num campo de texto livre (ex.: observações),
 * sem depender de prever cada caso individualmente. Acentos latinos
 * (á, ã, ç, õ...) têm código ≤ 0xFF e nunca são afetados.
 */
export function toPdfSafeText(text: string): string {
  return text.replace(/[^\x20-\xFF]/g, '').trim()
}

/**
 * Layout reorganizado (achado real de QA física em Production — o símbolo
 * Numora ao lado do NMR competia visualmente com o identificador):
 *   TOPO — símbolo Numora pequeno e discreto, isolado.
 *   CENTRO — denominação, país+ano, composição, detalhes (peso/grade/valor).
 *   RODAPÉ — NMR sozinho, sem nenhum outro elemento na mesma linha.
 * Nenhum campo novo foi adicionado — mesmo conjunto de informações do V1,
 * só reposicionado.
 */
function drawLabel(doc: jsPDF, x: number, y: number, qrDataUrl: string, symbolDataUrl: string, data: LabelData): void {
  const lines = getPrintSafeLabelLines(data)

  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.25)
  doc.roundedRect(x, y, LABEL_WIDTH_MM, LABEL_HEIGHT_MM, 1.5, 1.5, 'S')

  const textX = x + PADDING_MM
  const textWidth = LABEL_WIDTH_MM - QR_SIZE_MM - PADDING_MM * 3

  // TOPO — símbolo isolado, nunca ao lado do NMR.
  doc.addImage(symbolDataUrl, 'PNG', textX, y + PADDING_MM - 1, SYMBOL_SIZE_MM, SYMBOL_SIZE_MM)

  let cursorY = y + PADDING_MM + SYMBOL_SIZE_MM + 3

  doc.setTextColor(...NAVY)

  if (lines.title) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(toPdfSafeText(doc.splitTextToSize(lines.title, textWidth)[0]), textX, cursorY)
    cursorY += 4.2
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  if (lines.originLine) {
    doc.text(toPdfSafeText(lines.originLine), textX, cursorY)
    cursorY += 3.4
  }
  if (lines.metalLine) {
    doc.text(toPdfSafeText(lines.metalLine), textX, cursorY)
    cursorY += 3.4
  }

  doc.setFontSize(6.5)
  const maxDetailLines = 2
  for (const detail of lines.detailLines.slice(0, maxDetailLines)) {
    doc.text(toPdfSafeText(doc.splitTextToSize(detail, textWidth)[0]), textX, cursorY)
    cursorY += 2.9
  }

  // RODAPÉ — NMR sozinho (nenhum outro elemento nesta linha).
  if (data.labelCode) {
    doc.setFontSize(6.5)
    doc.setTextColor(...GOLD)
    doc.text(toPdfSafeText(data.labelCode), textX, y + LABEL_HEIGHT_MM - PADDING_MM)
  }

  const qrX = x + LABEL_WIDTH_MM - QR_SIZE_MM - PADDING_MM
  const qrY = y + (LABEL_HEIGHT_MM - QR_SIZE_MM) / 2
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, QR_SIZE_MM, QR_SIZE_MM)
}

/**
 * Gera o PDF A4 completo (1 ou mais páginas, paginação automática) para a
 * lista de etiquetas informada — sem limite de quantidade (decisão do
 * owner). Retorna um `Blob` pronto para download/nova aba; nunca abre
 * `window.open`/dispara download sozinho (quem chama decide a UX de
 * entrega, mantendo esta função pura o suficiente para ser testável em
 * isolamento quanto à paginação/geometria).
 */
export async function generateLabelsPdf(labels: LabelData[]): Promise<Blob> {
  const [symbolDataUrl, qrDataUrls] = await Promise.all([
    loadSymbolDataUrl(),
    Promise.all(labels.map((label) => generateLabelQrDataUrl(label.qrTargetUrl))),
  ])

  const doc = new jsPDF({ unit: 'mm', format: [A4_WIDTH_MM, A4_HEIGHT_MM] })
  const pages = paginateLabels(labels)
  let globalIndex = 0

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) doc.addPage([A4_WIDTH_MM, A4_HEIGHT_MM])

    page.forEach((label, indexOnPage) => {
      const { xMm, yMm } = labelPositionOnPage(indexOnPage)
      drawLabel(doc, xMm, yMm, qrDataUrls[globalIndex], symbolDataUrl, label)
      globalIndex += 1
    })
  })

  return doc.output('blob')
}
