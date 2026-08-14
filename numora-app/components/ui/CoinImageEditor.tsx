/**
 * components/ui/CoinImageEditor.tsx
 * Editor de recorte genérico (não sabe nada de moedas/exemplares — só
 * "arquivo de imagem" + "forma do recorte") usado antes do upload de
 * qualquer foto de exemplar. Padrão comum de crop de foto de perfil:
 * a imagem inteira fica visível e arrastável num viewport; uma forma
 * fixa no centro (círculo ou faixa larga) marca o que será capturado;
 * a área fora da forma escurece via um único truque de CSS
 * (`box-shadow` gigante no elemento da própria forma) — sem SVG, sem
 * canvas extra só para a máscara.
 *
 * Overlay de zoom/pan é resolvido aqui; a codificação final para WebP
 * comprimido (que conhece o teto de bytes por tipo de foto) continua em
 * `lib/images/process-coin-image.ts` — este componente só entrega o
 * canvas já recortado na resolução de saída pedida via `onConfirm`.
 *
 * Usa o `Modal` existente (não uma implementação própria) para herdar de
 * graça a pilha de modais e o fix de foco que evita Space fechar o modal
 * sozinho — nenhum desses comportamentos é reimplementado aqui.
 */
'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Minus, Plus, Crosshair, Loader2 } from 'lucide-react'

import { Modal } from './Modal'
import { Button } from './Button'
import { loadCoinImageBitmap } from '@/lib/images/process-coin-image'

export type CoinImageEditorShape = 'circle' | 'wide'

export interface CoinImageEditorProps {
  file: File | null
  shape: CoinImageEditorShape
  outputWidth: number
  outputHeight: number
  title: string
  hint: string
  onCancel: () => void
  onConfirm: (canvas: HTMLCanvasElement) => void
}

const VIEWPORT_WIDTH = 320
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.2

interface Point {
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function CoinImageEditor({
  file,
  shape,
  outputWidth,
  outputHeight,
  title,
  hint,
  onCancel,
  onConfirm,
}: CoinImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null)

  const viewportWidth = VIEWPORT_WIDTH
  const viewportHeight = shape === 'circle' ? VIEWPORT_WIDTH : Math.round(VIEWPORT_WIDTH * (outputHeight / outputWidth))

  const cropSize = (() => {
    if (shape === 'circle') {
      const diameter = Math.min(viewportWidth, viewportHeight) * 0.82
      return { width: diameter, height: diameter }
    }
    let width = viewportWidth * 0.92
    let height = width / (outputWidth / outputHeight)
    if (height > viewportHeight * 0.92) {
      height = viewportHeight * 0.92
      width = height * (outputWidth / outputHeight)
    }
    return { width, height }
  })()

  const baseScale = bitmap ? Math.max(cropSize.width / bitmap.width, cropSize.height / bitmap.height) : 1

  const clampPan = useCallback(
    (candidate: Point, scale: number): Point => {
      if (!bitmap) return candidate
      const dispW = bitmap.width * scale
      const dispH = bitmap.height * scale
      const maxX = (dispW - cropSize.width) / 2
      const maxY = (dispH - cropSize.height) / 2
      return { x: clamp(candidate.x, -maxX, maxX), y: clamp(candidate.y, -maxY, maxY) }
    },
    [bitmap, cropSize.width, cropSize.height],
  )

  // Carrega o bitmap do arquivo recebido. O pai remonta este componente (via
  // `key`) a cada novo arquivo escolhido, então zoom/pan/erro já nascem no
  // valor inicial de cada `useState` — não precisam ser resetados aqui.
  useEffect(() => {
    if (!file) return

    let cancelled = false

    loadCoinImageBitmap(file)
      .then((loaded) => {
        if (cancelled) {
          loaded.close()
          return
        }
        setBitmap(loaded)
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message)
      })

    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    return () => {
      bitmap?.close()
    }
  }, [bitmap])

  // Redesenha o canvas de fundo a cada mudança de zoom/pan/imagem.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.fillStyle = '#0b0d10'
    ctx.fillRect(0, 0, viewportWidth, viewportHeight)

    if (!bitmap) return

    const scale = baseScale * zoom
    const dispW = bitmap.width * scale
    const dispH = bitmap.height * scale
    const imgX = viewportWidth / 2 - dispW / 2 + pan.x
    const imgY = viewportHeight / 2 - dispH / 2 + pan.y
    ctx.drawImage(bitmap, imgX, imgY, dispW, dispH)
  }, [bitmap, zoom, pan, baseScale, viewportWidth, viewportHeight])

  function updateZoom(nextZoom: number) {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    setZoom(clampedZoom)
    setPan((current) => clampPan(current, baseScale * clampedZoom))
  }

  function handleCenter() {
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!bitmap) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, panX: pan.x, panY: pan.y }
    setIsDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isDragging || !dragOrigin.current) return
    const dx = event.clientX - dragOrigin.current.pointerX
    const dy = event.clientY - dragOrigin.current.pointerY
    setPan(clampPan({ x: dragOrigin.current.panX + dx, y: dragOrigin.current.panY + dy }, baseScale * zoom))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragOrigin.current = null
    setIsDragging(false)
  }

  async function handleConfirm() {
    if (!bitmap) return
    setIsConfirming(true)
    try {
      const scale = baseScale * zoom
      const dispW = bitmap.width * scale
      const dispH = bitmap.height * scale
      const imgX = viewportWidth / 2 - dispW / 2 + pan.x
      const imgY = viewportHeight / 2 - dispH / 2 + pan.y
      const cropLeft = viewportWidth / 2 - cropSize.width / 2
      const cropTop = viewportHeight / 2 - cropSize.height / 2

      const sourceX = (cropLeft - imgX) / scale
      const sourceY = (cropTop - imgY) / scale
      const sourceW = cropSize.width / scale
      const sourceH = cropSize.height / scale

      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = outputWidth
      outputCanvas.height = outputHeight
      const outputCtx = outputCanvas.getContext('2d')
      if (!outputCtx) throw new Error('Canvas 2D não suportado neste navegador.')
      outputCtx.drawImage(bitmap, sourceX, sourceY, sourceW, sourceH, 0, 0, outputWidth, outputHeight)

      onConfirm(outputCanvas)
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <Modal
      isOpen={file !== null}
      onClose={onCancel}
      title={title}
      description="Foto do exemplar físico"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isConfirming}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!bitmap || isConfirming} isLoading={isConfirming}>
            Usar esta foto
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {loadError ? (
          <p className="text-sm text-danger">{loadError}</p>
        ) : (
          <>
            <p className="text-center text-xs text-text-secondary">{hint}</p>

            <div
              className="relative overflow-hidden rounded-lg"
              style={{ width: viewportWidth, height: viewportHeight }}
            >
              <canvas
                ref={canvasRef}
                width={viewportWidth}
                height={viewportHeight}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className={`touch-none ${bitmap ? 'cursor-grab active:cursor-grabbing' : ''}`}
                role="img"
                aria-label="Arraste para posicionar a imagem"
              />
              {!bitmap && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
                </div>
              )}
              <div
                className="pointer-events-none absolute border-2 border-white/90"
                style={{
                  left: viewportWidth / 2 - cropSize.width / 2,
                  top: viewportHeight / 2 - cropSize.height / 2,
                  width: cropSize.width,
                  height: cropSize.height,
                  borderRadius: shape === 'circle' ? '9999px' : '10px',
                  boxShadow: '0 0 0 9999px rgba(11, 13, 16, 0.65)',
                }}
              >
                {/* Guia discreta de centralização — só na máscara circular (frente/verso). */}
                {shape === 'circle' && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-40">
                    <div className="absolute h-px w-4 bg-white" />
                    <div className="absolute h-4 w-px bg-white" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex w-full max-w-xs items-center gap-3">
              <button
                type="button"
                onClick={() => updateZoom(zoom - ZOOM_STEP)}
                disabled={!bitmap}
                aria-label="Diminuir zoom"
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                disabled={!bitmap}
                onChange={(e) => updateZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="h-1.5 flex-1 accent-accent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => updateZoom(zoom + ZOOM_STEP)}
                disabled={!bitmap}
                aria-label="Aumentar zoom"
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>

            <button
              type="button"
              onClick={handleCenter}
              disabled={!bitmap}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Crosshair className="size-3.5" aria-hidden />
              Centralizar
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
