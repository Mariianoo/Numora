/**
 * lib/images/process-coin-image.ts
 * Pipeline de processamento de fotos de exemplar — inteiramente no
 * navegador (Canvas API nativa, sem dependência nova, sem Edge
 * Function): valida formato → redimensiona → converte para WebP →
 * comprime progressivamente até caber no teto do tipo. O arquivo
 * original nunca é enviado a lugar nenhum — só o resultado processado
 * (`ProcessedCoinImage.blob`) sai desta função.
 *
 * Tetos por tipo (`MAX_BYTES`) e resolução (`MAX_DIMENSION_PX`) seguem a
 * arquitetura aprovada: frente/verso até 400 KB, borda até 300 KB, maior
 * eixo até 1600px — suficiente para consultar data/legenda/defeitos sem
 * gerar arquivos grandes no Free do Supabase.
 */
import type { CoinImageKind } from '@/features/coin-images/types'

const MAX_DIMENSION_PX = 1600
const QUALITY_START = 0.82
const QUALITY_FLOOR = 0.5
const QUALITY_STEP = 0.07

const MAX_BYTES: Record<CoinImageKind, number> = {
  front: 400 * 1024,
  back: 400 * 1024,
  edge: 300 * 1024,
}

/** MIME types aceitos como entrada — qualquer outro (incluindo HEIC/GIF/SVG) é rejeitado. */
const ACCEPTED_INPUT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export class UnsupportedImageFormatError extends Error {}
export class ImageTooLargeError extends Error {}

export interface ProcessedCoinImage {
  blob: Blob
  width: number
  height: number
}

export async function processCoinImage(file: File, kind: CoinImageKind): Promise<ProcessedCoinImage> {
  if (!ACCEPTED_INPUT_TYPES.has(file.type)) {
    throw new UnsupportedImageFormatError('Formato não suportado. Envie uma foto em JPEG, PNG ou WebP.')
  }

  const bitmap = await createImageBitmap(file)

  try {
    const { width, height } = fitWithinMaxDimension(bitmap.width, bitmap.height, MAX_DIMENSION_PX)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('[processCoinImage] Canvas 2D não suportado neste navegador.')
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    const maxBytes = MAX_BYTES[kind]
    let quality = QUALITY_START
    let blob = await canvasToWebpBlob(canvas, quality)

    while (blob.size > maxBytes && quality > QUALITY_FLOOR) {
      quality = Math.max(QUALITY_FLOOR, quality - QUALITY_STEP)
      blob = await canvasToWebpBlob(canvas, quality)
    }

    if (blob.size > maxBytes) {
      throw new ImageTooLargeError(
        'Essa imagem ainda está muito grande. Ajuste o enquadramento ou tente uma foto com menor resolução.',
      )
    }

    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}

function fitWithinMaxDimension(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height }
  const scale = max / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('[processCoinImage] Falha ao gerar WebP.'))
      },
      'image/webp',
      quality,
    )
  })
}
