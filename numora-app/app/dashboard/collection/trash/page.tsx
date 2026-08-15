/**
 * app/dashboard/collection/trash/page.tsx
 * Lixeira (Etapa Lixeira/Soft Delete) — moedas com `deleted_at` preenchido,
 * a única fonte de verdade para "não está mais na coleção ativa". Client
 * Component (mesmo padrão de app/dashboard/collection/page.tsx): busca via
 * `CollectionRepository.listTrashed()`, nunca chama Supabase diretamente.
 *
 * Reaproveita integralmente a infraestrutura de imagens existente —
 * `coinImagesRepository.getSignedUrls` (mesmo lote único usado na Grid,
 * sem N+1) e `CoinImageViewer` (mesmo componente, sem alteração) — não
 * existe nenhum sistema de imagens novo aqui.
 *
 * "Restaurar" é uma ação simples (`collectionRepository.restore`, sem
 * confirmação — reversível e de baixo risco). "Excluir permanentemente"
 * reaproveita o `ConfirmDialog` já usado em Coleção, mas com
 * `isDestructive` e copy realmente irreversível — chama
 * `collectionRepository.remove()`, a MESMA operação destrutiva que antes
 * era acionada direto da coleção ativa, agora só alcançável a partir daqui.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Award, Bookmark, Layers, Loader2, PackageOpen, RotateCcw, Trash2 } from 'lucide-react'

import { createSupabaseCollectionRepository } from '@/features/collection/repositories/collection.repository'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import type { CollectionItem, CollectionItemUnit } from '@/features/collection/types'
import type { CollectionUnit } from '@/features/collection-units/types'
import type { CoinImageKind } from '@/features/coin-images/types'
import { formatTimestampDate } from '@/lib/format/date'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CoinImageViewer } from '@/components/ui/CoinImageViewer'

const collectionRepository = createSupabaseCollectionRepository()
const coinImagesRepository = createSupabaseCoinImagesRepository()

function getPrimaryUnit(item: CollectionItem): CollectionItemUnit | null {
  return item.units.find((u) => u.isPrimary) ?? item.units[0] ?? null
}

export default function TrashPage() {
  const [items, setItems] = useState<CollectionItem[]>([])
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [itemPendingPermanentDelete, setItemPendingPermanentDelete] = useState<CollectionItem | null>(null)
  const [isDeletingPermanently, setIsDeletingPermanently] = useState(false)
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null)

  /**
   * `key` incremental (mesmo padrão de app/dashboard/collection/page.tsx)
   * força o CoinImageViewer a REMONTAR a cada abertura — sem isso, seu
   * `useState(initialUnitId)` interno só captura o valor no primeiro
   * mount (quando `isOpen` ainda é `false` e `initialUnitId` é `''`) e
   * nunca mais atualiza, fazendo o viewer não encontrar a unit e não
   * renderizar nada (bug real encontrado em teste manual nesta etapa).
   */
  const [viewerState, setViewerState] = useState<
    { units: CollectionUnit[]; unitId: string; kind: CoinImageKind; key: number } | null
  >(null)

  function openViewer(units: CollectionUnit[], unitId: string, kind: CoinImageKind) {
    setViewerState((current) => ({ units, unitId, kind, key: (current?.key ?? 0) + 1 }))
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const trashed = await collectionRepository.listTrashed()
        if (cancelled) return
        setItems(trashed)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Mesmo padrão da Grid ativa: um único lote de signed URLs para todas as
  // miniaturas visíveis (imagem de frente do exemplar principal de cada
  // item), nunca uma request por card.
  const neededThumbPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const item of items) {
      const primary = getPrimaryUnit(item)
      const front = primary?.images.find((image) => image.kind === 'front') ?? primary?.images[0]
      if (front) paths.add(front.storagePath)
    }
    return Array.from(paths)
  }, [items])

  useEffect(() => {
    if (neededThumbPaths.length === 0) return
    let cancelled = false
    coinImagesRepository.getSignedUrls(neededThumbPaths).then((urls) => {
      if (!cancelled) setThumbUrls((current) => ({ ...current, ...urls }))
    })
    return () => {
      cancelled = true
    }
  }, [neededThumbPaths])

  async function handleRestore(item: CollectionItem) {
    setRestoringId(item.id)
    setError(null)
    try {
      await collectionRepository.restore(item.id)
      setItems((current) => current.filter((i) => i.id !== item.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRestoringId(null)
    }
  }

  function closePermanentDeleteConfirm() {
    setItemPendingPermanentDelete(null)
    setPermanentDeleteError(null)
  }

  async function confirmPermanentDelete() {
    const item = itemPendingPermanentDelete
    if (!item) return

    setIsDeletingPermanently(true)
    setPermanentDeleteError(null)
    try {
      await collectionRepository.remove(item.id)
      setItems((current) => current.filter((i) => i.id !== item.id))
      closePermanentDeleteConfirm()
    } catch (err) {
      setPermanentDeleteError((err as Error).message)
    } finally {
      setIsDeletingPermanently(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lixeira"
        description="Moedas removidas da sua coleção ativa — restaure ou exclua permanentemente."
        actions={
          <Link
            href="/dashboard/collection"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface-hover px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Voltar para a coleção
          </Link>
        }
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={PackageOpen} title="A lixeira está vazia" description="Moedas movidas para a lixeira aparecerão aqui." />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const primary = getPrimaryUnit(item)
            const front = primary?.images.find((image) => image.kind === 'front') ?? primary?.images[0]
            const url = front ? thumbUrls[front.storagePath] : undefined

            return (
              <Card key={item.id} className="flex flex-col overflow-hidden">
                <div className="relative aspect-[4/3] bg-gradient-to-br from-surface-hover to-surface">
                  {url && front ? (
                    <button
                      type="button"
                      onClick={() => primary && openViewer(item.units, primary.id, front.kind)}
                      className="flex size-full items-center justify-center bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      aria-label={`Ver foto de ${item.denomination ?? 'moeda'}`}
                    >
                      <div className="relative aspect-square h-full max-w-full overflow-hidden rounded-full">
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL temporária, não é asset estático do Next */}
                        <img src={url} alt={item.denomination ?? 'moeda'} className="size-full object-cover" />
                      </div>
                    </button>
                  ) : (
                    <div className="flex size-full items-center justify-center text-text-secondary">
                      <PackageOpen className="size-7 opacity-50" aria-hidden />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <p className="font-semibold text-text-primary">{item.denomination ?? 'Sem denominação'}</p>
                    <p className="mt-0.5 text-sm text-text-secondary">
                      {item.countryFlagEmoji ? `${item.countryFlagEmoji} ` : ''}
                      {item.countryDisplayName ?? item.countryCode ?? '—'} · {item.year ?? '—'}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <Layers className="size-3.5 shrink-0" aria-hidden />
                      {item.units.length} exemplar{item.units.length === 1 ? '' : 'es'}
                    </span>
                    {item.purchase && (
                      <span className="flex items-center gap-1.5">
                        <Bookmark className="size-3.5 shrink-0" aria-hidden />
                        Valor de aquisição: R$ {item.purchase.totalPrice.toFixed(2)}
                      </span>
                    )}
                    {item.deletedAt && (
                      <span className="flex items-center gap-1.5">
                        <Award className="size-3.5 shrink-0" aria-hidden />
                        Excluída em {formatTimestampDate(item.deletedAt)}
                      </span>
                    )}
                  </div>

                  <div className="mt-auto flex gap-2 border-t border-border pt-3.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      isLoading={restoringId === item.id}
                      onClick={() => handleRestore(item)}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Restaurar
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => setItemPendingPermanentDelete(item)}
                      aria-label="Excluir permanentemente"
                      title="Excluir permanentemente"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={itemPendingPermanentDelete !== null}
        onClose={closePermanentDeleteConfirm}
        onConfirm={confirmPermanentDelete}
        title="Excluir permanentemente?"
        description="Esta ação removerá definitivamente a moeda, seus exemplares e suas fotos. Não será possível restaurá-la."
        warning="Esta ação não pode ser desfeita."
        icon={Trash2}
        isDestructive
        confirmLabel="Excluir permanentemente"
        isLoading={isDeletingPermanently}
        error={permanentDeleteError}
      >
        {itemPendingPermanentDelete && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
            <p className="font-medium text-text-primary">
              {itemPendingPermanentDelete.denomination ?? 'Sem denominação'}
            </p>
            <p className="text-text-secondary">
              {itemPendingPermanentDelete.countryFlagEmoji ? `${itemPendingPermanentDelete.countryFlagEmoji} ` : ''}
              {itemPendingPermanentDelete.countryDisplayName ?? itemPendingPermanentDelete.countryCode ?? '—'}
              {itemPendingPermanentDelete.year !== null ? ` · ${itemPendingPermanentDelete.year}` : ''}
            </p>
            <p className="text-text-secondary">
              {itemPendingPermanentDelete.units.length} exemplar{itemPendingPermanentDelete.units.length === 1 ? '' : 'es'}
            </p>
          </div>
        )}
      </ConfirmDialog>

      <CoinImageViewer
        key={viewerState?.key}
        isOpen={viewerState !== null}
        units={viewerState?.units ?? []}
        initialUnitId={viewerState?.unitId ?? ''}
        initialKind={viewerState?.kind ?? 'front'}
        onClose={() => setViewerState(null)}
      />
    </div>
  )
}
