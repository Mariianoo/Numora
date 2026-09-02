/**
 * lib/images/watermark-coin-image.ts
 * Fundação de governança de imagens — gera a DERIVAÇÃO PÚBLICA de uma foto
 * de moeda (marca d'água "NUMORA COLLECT" + @username), inteiramente no
 * navegador via Canvas API nativa — mesmo pipeline sem dependência nova já
 * usado por `process-coin-image.ts` para o upload original.
 *
 * Nunca toca na imagem original privada: recebe um `ImageBitmap` (carregado
 * a partir de uma signed URL do bucket privado `coin-images`) e devolve um
 * `Blob` WebP novo, pronto para ir ao bucket público `coin-images-public`.
 * Redesenhar num canvas e reexportar via `toBlob` já descarta qualquer
 * metadado EXIF/GPS do arquivo de origem — `canvas.toBlob` nunca copia
 * metadados, só os pixels rasterizados — então a remoção de EXIF/GPS é uma
 * garantia estrutural deste pipeline, não uma etapa separada que possa ser
 * esquecida.
 */
import type { ProcessedCoinImage } from '@/lib/images/process-coin-image'

const WATERMARK_QUALITY = 0.85
const WATERMARK_MAX_BYTES = 400 * 1024

/** Nome de marca fixo — "discreto, mas suficientemente visível para dificultar reutilização indevida" (pedido explícito desta etapa). */
const BRAND_LABEL = 'NUMORA COLLECT'

/**
 * Desenha a faixa de marca d'água na base da imagem (fundo semitransparente
 * + texto), depois reexporta como WebP. `username`, quando informado, some
 * junto na mesma faixa ("NUMORA COLLECT • @username") — nunca em uma
 * chamada separada, para não arriscar desalinhar as duas marcas.
 */
export async function applyPublicWatermark(source: ImageBitmap, username: string | null): Promise<ProcessedCoinImage> {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('[watermark-coin-image] Canvas 2D não disponível neste navegador.')
  }

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

  const bandHeight = Math.max(28, Math.round(canvas.height * 0.09))
  ctx.fillStyle = 'rgba(13, 13, 13, 0.55)'
  ctx.fillRect(0, canvas.height - bandHeight, canvas.width, bandHeight)

  const label = username ? `${BRAND_LABEL} • @${username}` : BRAND_LABEL
  const fontSize = Math.max(11, Math.round(bandHeight * 0.4))
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, canvas.width / 2, canvas.height - bandHeight / 2, canvas.width - 24)

  let quality = WATERMARK_QUALITY
  let blob = await canvasToWebpBlob(canvas, quality)

  while (blob.size > WATERMARK_MAX_BYTES && quality > 0.5) {
    quality = Math.max(0.5, quality - 0.05)
    blob = await canvasToWebpBlob(canvas, quality)
  }

  return { blob, width: canvas.width, height: canvas.height }
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('[watermark-coin-image] Falha ao gerar WebP com marca d\'água.'))
      },
      'image/webp',
      quality,
    )
  })
}
