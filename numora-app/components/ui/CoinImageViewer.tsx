/**
 * components/ui/CoinImageViewer.tsx
 * Visualizador premium das fotos de um exemplar (Etapa 9.3) — reutiliza
 * integralmente a infraestrutura de imagens já existente (Etapa 9.1/9.2):
 * `CoinImagesRepository.listByUnit`/`.getSignedUrl` (RLS + Storage
 * policies inalteradas), nenhuma tabela nova, nenhum bucket novo, nenhum
 * upload aqui — só leitura.
 *
 * Cache por sessão do componente (não persiste entre aberturas com `key`
 * diferente, mas persiste entre navegações de exemplar/aba dentro da
 * mesma abertura): `imagesByUnit` evita re-listar um exemplar já
 * visitado; `signedUrls` evita gerar de novo uma signed URL já obtida
 * para o mesmo path — atende diretamente ao pedido de não duplicar
 * requests nem regenerar signed URLs à toa.
 *
 * Zoom/pan usam CSS transform sobre um `<img>` com `object-fit: cover`
 * (a imagem sempre cobre o viewport a partir de zoom 1×, então nunca
 * "some" da área visível) — sem canvas aqui: o recorte/processamento já
 * aconteceu no upload (CoinImageEditor), este componente só exibe.
 * Pinch-to-zoom é feito rastreando até 2 Pointer Events simultâneos (o
 * mesmo mecanismo unifica mouse/touch/caneta) — sem biblioteca nova.
 *
 * `ZoomableImage` é montado com `key={unitId:kind}` pelo componente pai —
 * trocar de exemplar ou de tipo remonta esse pedaço, o que zera
 * zoom/pan/drag "de graça" via valor inicial do `useState`, sem precisar
 * de um efeito que chame `setState` a cada mudança (regra
 * react-hooks/set-state-in-effect — mesma solução já usada no
 * CoinImageEditor).
 *
 * Usa o `Modal` existente para herdar de graça a pilha de modais e o fix
 * de foco (Space não fecha o modal).
 */
'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { ChevronLeft, ChevronRight, Circle, Coins, Crosshair, Loader2, Minus, Plus, Star } from 'lucide-react'

import { Modal } from './Modal'
import { Badge } from './Badge'
import { cn } from './utils'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import { COIN_IMAGE_KINDS, COIN_IMAGE_KIND_LABELS, type CoinImage, type CoinImageKind } from '@/features/coin-images/types'
import { OUTPUT_SIZE } from '@/lib/images/process-coin-image'
import {
  COLLECTION_UNIT_STATUS_EMOJI,
  COLLECTION_UNIT_STATUS_LABELS,
  type CollectionUnit,
} from '@/features/collection-units/types'

const coinImagesRepository = createSupabaseCoinImagesRepository()

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.2
const WHEEL_ZOOM_SENSITIVITY = 0.0015

export interface CoinImageViewerProps {
  isOpen: boolean
  units: CollectionUnit[]
  initialUnitId: string
  initialKind: CoinImageKind
  onClose: () => void
}

interface Point {
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function distanceBetween(points: Point[]): number {
  const [a, b] = points
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function ViewerStars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="text-xs text-text-secondary/60">Sem avaliação</span>
  }
  return (
    <span className="flex items-center gap-0.5" aria-label={`Avaliação pessoal: ${rating} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-3.5 ${n <= rating ? 'fill-accent text-accent' : 'text-text-secondary/30'}`} aria-hidden />
      ))}
    </span>
  )
}

/**
 * A imagem propriamente dita + zoom/pan/wheel/pinch. Remontada (via
 * `key` no componente pai) a cada troca de exemplar ou de tipo — por
 * isso zoom/pan sempre nascem no padrão, sem precisar de efeito para
 * resetá-los.
 */
function ZoomableImage({
  image,
  url,
  outputSize,
  kindLabel,
  exemplarLabel,
  isLoading,
  EmptyIcon,
}: {
  image: CoinImage | null
  url: string | undefined
  outputSize: { width: number; height: number }
  kindLabel: string
  exemplarLabel: string
  isLoading: boolean
  EmptyIcon: typeof Circle
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })

  const viewportRef = useRef<HTMLDivElement>(null)
  const activePointers = useRef(new Map<number, Point>())
  const dragOrigin = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)

  function getMaxPan(zoomValue: number): Point {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (rect.width * (zoomValue - 1)) / 2, y: (rect.height * (zoomValue - 1)) / 2 }
  }

  function clampPan(candidate: Point, zoomValue: number): Point {
    const max = getMaxPan(zoomValue)
    return { x: clamp(candidate.x, -max.x, max.x), y: clamp(candidate.y, -max.y, max.y) }
  }

  function updateZoom(nextZoom: number) {
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    setZoom(clamped)
    setPan((current) => clampPan(current, clamped))
  }

  function handleCenter() {
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!image) return
    event.preventDefault()
    updateZoom(zoom - event.deltaY * WHEEL_ZOOM_SENSITIVITY)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image) return
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (activePointers.current.size === 2) {
      const points = Array.from(activePointers.current.values())
      pinchStart.current = { distance: distanceBetween(points), zoom }
      dragOrigin.current = null
    } else if (activePointers.current.size === 1) {
      dragOrigin.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePointers.current.has(event.pointerId)) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (activePointers.current.size === 2 && pinchStart.current) {
      const points = Array.from(activePointers.current.values())
      const ratio = distanceBetween(points) / pinchStart.current.distance
      updateZoom(pinchStart.current.zoom * ratio)
    } else if (activePointers.current.size === 1 && dragOrigin.current) {
      const dx = event.clientX - dragOrigin.current.x
      const dy = event.clientY - dragOrigin.current.y
      setPan(clampPan({ x: dragOrigin.current.panX + dx, y: dragOrigin.current.panY + dy }, zoom))
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    activePointers.current.delete(event.pointerId)

    if (activePointers.current.size === 0) {
      dragOrigin.current = null
      pinchStart.current = null
    } else if (activePointers.current.size === 1) {
      const [[, point]] = activePointers.current
      dragOrigin.current = { x: point.x, y: point.y, panX: pan.x, panY: pan.y }
      pinchStart.current = null
    }
  }

  return (
    <>
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-full max-w-[420px] touch-none overflow-hidden rounded-lg border border-border bg-background"
        style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
      >
        {image && url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL temporária, não é asset estático do Next
          <img
            src={url}
            alt={`Foto de ${kindLabel} — ${exemplarLabel}`}
            draggable={false}
            className={cn('size-full select-none object-cover', zoom > MIN_ZOOM ? 'cursor-grab active:cursor-grabbing' : '')}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
          />
        ) : isLoading || (image && !url) ? (
          <div className="flex size-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-text-secondary">
            <EmptyIcon className="size-6 opacity-50" aria-hidden />
            <span className="text-xs">Sem foto de {kindLabel.toLowerCase()}</span>
          </div>
        )}
      </div>

      <div className="flex w-full max-w-xs items-center gap-3">
        <button
          type="button"
          onClick={() => updateZoom(zoom - ZOOM_STEP)}
          disabled={!image}
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
          disabled={!image}
          onChange={(e) => updateZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="h-1.5 flex-1 accent-accent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => updateZoom(zoom + ZOOM_STEP)}
          disabled={!image}
          aria-label="Aumentar zoom"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>

      <button
        type="button"
        onClick={handleCenter}
        disabled={!image}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <Crosshair className="size-3.5" aria-hidden />
        Centralizar
      </button>
    </>
  )
}

export function CoinImageViewer({ isOpen, units, initialUnitId, initialKind, onClose }: CoinImageViewerProps) {
  const [currentUnitId, setCurrentUnitId] = useState(initialUnitId)
  const [currentKind, setCurrentKind] = useState<CoinImageKind>(initialKind)
  const [imagesByUnit, setImagesByUnit] = useState<Record<string, CoinImage[]>>({})
  const [loadingUnitId, setLoadingUnitId] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const fetchedUnitsRef = useRef(new Set<string>())
  const fetchedUrlsRef = useRef(new Set<string>())

  const currentIndex = units.findIndex((u) => u.id === currentUnitId)
  const unit = currentIndex !== -1 ? units[currentIndex] : null
  const currentImages = imagesByUnit[currentUnitId] ?? []
  const currentImage = currentImages.find((img) => img.kind === currentKind) ?? null
  const currentUrl = currentImage ? signedUrls[currentImage.storagePath] : undefined
  const isLoadingImages = loadingUnitId === currentUnitId
  const outputSize = OUTPUT_SIZE[currentKind]
  const EmptyIcon = currentKind === 'edge' ? Circle : Coins

  // Lista as fotos do exemplar atual uma única vez por exemplar visitado nesta sessão do viewer.
  //
  // O guard de "já busquei" (`fetchedUnitsRef`) precisa sobreviver a um
  // efeito cancelado sem sobreviver a uma promise que nunca vai resolver:
  // em desenvolvimento, o StrictMode do React invoca o efeito, cancela
  // (roda o cleanup) e invoca de novo — se a 1ª chamada ainda estivesse
  // "em voo" quando o cleanup marca `cancelled=true`, e o guard já tivesse
  // marcado o id como buscado, a 2ª invocação pularia por achar que já
  // tinha um fetch em andamento, e a 1ª nunca aplicaria o resultado (por
  // estar cancelada) — o resultado seria nenhuma tentativa bem-sucedida.
  // `settled` resolve isso: só mantemos o id marcado no guard se a
  // promise realmente chegou a resolver/rejeitar antes do cleanup rodar;
  // caso contrário, liberamos para a próxima invocação tentar de novo.
  useEffect(() => {
    const fetchedUnits = fetchedUnitsRef.current
    if (!isOpen || fetchedUnits.has(currentUnitId)) return
    fetchedUnits.add(currentUnitId)

    const state = { cancelled: false, settled: false }
    setLoadingUnitId(currentUnitId)
    setError(null)

    coinImagesRepository
      .listByUnit(currentUnitId)
      .then((images) => {
        state.settled = true
        if (!state.cancelled) setImagesByUnit((current) => ({ ...current, [currentUnitId]: images }))
      })
      .catch((err) => {
        state.settled = true
        fetchedUnits.delete(currentUnitId)
        if (!state.cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!state.cancelled) setLoadingUnitId((current) => (current === currentUnitId ? null : current))
      })

    return () => {
      state.cancelled = true
      if (!state.settled) fetchedUnits.delete(currentUnitId)
    }
  }, [isOpen, currentUnitId])

  // Gera a signed URL da foto exibida uma única vez por path nesta sessão do viewer — mesmo padrão acima.
  useEffect(() => {
    const fetchedUrls = fetchedUrlsRef.current
    if (!isOpen || !currentImage) return
    const path = currentImage.storagePath
    if (fetchedUrls.has(path)) return
    fetchedUrls.add(path)

    const state = { cancelled: false, settled: false }
    coinImagesRepository
      .getSignedUrl(path)
      .then((url) => {
        state.settled = true
        if (!state.cancelled) setSignedUrls((current) => ({ ...current, [path]: url }))
      })
      .catch((err) => {
        state.settled = true
        fetchedUrls.delete(path)
        if (!state.cancelled) setError((err as Error).message)
      })

    return () => {
      state.cancelled = true
      if (!state.settled) fetchedUrls.delete(path)
    }
  }, [isOpen, currentImage])

  function goToUnit(index: number) {
    if (index < 0 || index >= units.length) return
    setCurrentUnitId(units[index].id)
  }

  if (!unit) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Exemplar #${currentIndex + 1}`}
      description={`ID curto: ${unit.id.slice(0, 8)}`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Badge tone="neutral">{unit.gradeLabel ?? 'Conservação não informada'}</Badge>
          <ViewerStars rating={unit.rating} />
          <Badge tone="neutral">
            {COLLECTION_UNIT_STATUS_EMOJI[unit.status]} {COLLECTION_UNIT_STATUS_LABELS[unit.status]}
          </Badge>
        </div>

        <div className="flex justify-center gap-2">
          {COIN_IMAGE_KINDS.map((k) => {
            const hasImage = currentImages.some((img) => img.kind === k)
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCurrentKind(k)}
                aria-pressed={currentKind === k}
                className={cn(
                  'rounded-full border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                  currentKind === k
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : hasImage
                      ? 'border-border text-text-secondary hover:text-text-primary'
                      : 'border-border text-text-secondary/40 hover:text-text-secondary',
                )}
              >
                {COIN_IMAGE_KIND_LABELS[k]}
              </button>
            )
          })}
        </div>

        <ZoomableImage
          key={`${currentUnitId}:${currentKind}`}
          image={currentImage}
          url={currentUrl}
          outputSize={outputSize}
          kindLabel={COIN_IMAGE_KIND_LABELS[currentKind]}
          exemplarLabel={`Exemplar #${currentIndex + 1}`}
          isLoading={isLoadingImages}
          EmptyIcon={EmptyIcon}
        />

        {error && <p className="text-center text-sm text-danger">{error}</p>}

        {units.length > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => goToUnit(currentIndex - 1)}
              disabled={currentIndex <= 0}
              aria-label="Exemplar anterior"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="min-w-32 text-center text-sm text-text-secondary">
              Exemplar #{currentIndex + 1} de {units.length}
            </span>
            <button
              type="button"
              onClick={() => goToUnit(currentIndex + 1)}
              disabled={currentIndex >= units.length - 1}
              aria-label="Próximo exemplar"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
