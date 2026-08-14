/**
 * lib/images/process-coin-image.ts
 * Pipeline de processamento de fotos de exemplar — inteiramente no
 * navegador (Canvas API nativa, sem dependência nova, sem Edge
 * Function). Duas responsabilidades separadas (Etapa 9.2, editor de
 * recorte):
 *
 * 1. `loadCoinImageBitmap` — carrega o arquivo original para edição.
 *    Não usa mais uma lista fixa de MIME types aceitos: em vez de
 *    recusar HEIC/HEIF de antemão, tentamos decodificar com
 *    `createImageBitmap` e só rejeitamos se o navegador realmente não
 *    conseguir (comportamento pedido: aceitar HEIC "se o navegador
 *    suportar leitura", sem adicionar um decoder em WASM). GIF e SVG são
 *    recusados antes mesmo de tentar — não fazem sentido como fotografia
 *    de moeda (animação/vetor).
 *
 * 2. `encodeCroppedCoinImage` — recebe o canvas JÁ recortado pelo editor
 *    (`CoinImageEditor`, na resolução final de saída) e só cuida de
 *    converter para WebP e comprimir progressivamente até caber no teto
 *    de bytes do tipo. O editor nunca faz upload nem conhece o teto de
 *    bytes — isso continua sendo responsabilidade só deste arquivo.
 *
 * Dimensões de saída (`OUTPUT_SIZE`) e tetos (`MAX_BYTES`) por tipo:
 * frente/verso saem quadradas (a moeda centralizada, como pedido);
 * borda sai como faixa horizontal (foto de perfil da moeda, não faz
 * sentido quadrada). Tetos de bytes mantidos da Etapa 9.1 (400/400/300 KB
 * — já validados como suficientes no Free do Supabase); qualidade inicial
 * ajustada para o meio da faixa 82–88% pedida nesta etapa.
 */
import type { CoinImageKind } from '@/features/coin-images/types'

export const OUTPUT_SIZE: Record<CoinImageKind, { width: number; height: number }> = {
  front: { width: 1200, height: 1200 },
  back: { width: 1200, height: 1200 },
  edge: { width: 1600, height: 640 },
}

const QUALITY_START = 0.85
const QUALITY_FLOOR = 0.5
const QUALITY_STEP = 0.05

const MAX_BYTES: Record<CoinImageKind, number> = {
  front: 400 * 1024,
  back: 400 * 1024,
  edge: 300 * 1024,
}

/** Nunca fazem sentido como fotografia de moeda — recusados sem tentar decodificar. */
const EXPLICITLY_REJECTED_TYPES = new Set(['image/gif', 'image/svg+xml'])

export class UnsupportedImageFormatError extends Error {}
export class ImageTooLargeError extends Error {}

export interface ProcessedCoinImage {
  blob: Blob
  width: number
  height: number
}

/** Carrega o arquivo original para o editor. Lança `UnsupportedImageFormatError` se não for possível. */
export async function loadCoinImageBitmap(file: File): Promise<ImageBitmap> {
  if (EXPLICITLY_REJECTED_TYPES.has(file.type)) {
    throw new UnsupportedImageFormatError('Formato não suportado. Envie uma foto em JPEG, PNG, WebP ou HEIC.')
  }

  try {
    return await createImageBitmap(file)
  } catch {
    throw new UnsupportedImageFormatError('Não foi possível abrir esta imagem. Tente outro arquivo (JPEG, PNG ou WebP).')
  }
}

/** Converte o canvas já recortado pelo editor em WebP comprimido, respeitando o teto do tipo. */
export async function encodeCroppedCoinImage(canvas: HTMLCanvasElement, kind: CoinImageKind): Promise<ProcessedCoinImage> {
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

  return { blob, width: canvas.width, height: canvas.height }
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('[process-coin-image] Falha ao gerar WebP.'))
      },
      'image/webp',
      quality,
    )
  })
}
