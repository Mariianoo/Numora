/**
 * app/dashboard/collection/page.tsx
 * "Minha Coleção" — primeira versão sobre o schema numismático real
 * (collection_items + purchases), substituindo a tabela antiga `coins`.
 * Só expõe um subconjunto dos campos de collection_items (ver
 * features/collection/types.ts) — organizado e usável.
 * Protegida pelo mesmo proxy que cobre /dashboard/:path*.
 *
 * Etapa UI/UX: busca e filtros (país/metal/conservação) são somente
 * client-side sobre os itens já carregados por `collectionRepository.list()`
 * — nenhuma query nova, nenhuma mudança de repositório/regra de negócio.
 *
 * Etapa de correções do formulário: segundo metal (bimetálica) usa a
 * coluna `secondary_metal_code`, que já existia no banco desde a Etapa 4
 * — nenhuma migration nesta etapa. Data da compra vem pré-preenchida com
 * hoje só ao ADICIONAR (nunca ao editar).
 */
'use client'

import { useCallback, useEffect, useRef, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Coins,
  ClipboardList,
  HelpCircle,
  ImagePlus,
  Landmark,
  Layers,
  Loader2,
  Pencil,
  PackageOpen,
  Plus,
  Receipt,
  RefreshCcw,
  Search,
  Star,
  Trash2,
} from 'lucide-react'

import { createSupabaseCollectionRepository } from '@/features/collection/repositories/collection.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import { createSupabaseCollectionUnitsRepository } from '@/features/collection-units/repositories/collection-units.repository'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import type { CollectionItem, Country, Grade, Metal } from '@/features/collection/types'
import {
  COLLECTION_UNIT_STATUS_LABELS,
  COLLECTION_UNIT_STATUS_OPTIONS,
  type CollectionUnit,
  type CollectionUnitStatus,
} from '@/features/collection-units/types'
import { COIN_IMAGE_KINDS, COIN_IMAGE_KIND_LABELS, type CoinImage, type CoinImageKind } from '@/features/coin-images/types'
import { processCoinImage, UnsupportedImageFormatError, ImageTooLargeError } from '@/lib/images/process-coin-image'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

const collectionRepository = createSupabaseCollectionRepository()
const referenceRepository = createSupabaseReferenceRepository()
const collectionUnitsRepository = createSupabaseCollectionUnitsRepository()
const coinImagesRepository = createSupabaseCoinImagesRepository()

/** Indicador visual rápido por status, usado na lista de exemplares (seção 12/13 da etapa). */
const STATUS_EMOJI: Record<CollectionUnitStatus, string> = {
  in_collection: '🟢',
  for_trade: '🔄',
  for_sale: '💰',
  reserved: '🔒',
  sold: '✅',
  traded: '🔁',
}

const GRADE_SCALE_LABELS: Record<string, string> = {
  br: 'Escala brasileira',
  sheldon: 'Escala Sheldon',
}

/**
 * Descrições da escala brasileira, chave = `code` real de `grades`
 * (confirmado no banco antes de escrever isto: SOF, REG, BC, MBC, SOB,
 * FC, PROOF — não os textos de exemplo genéricos, que não batiam com a
 * taxonomia real do Numora).
 */
const GRADE_BR_HELP: Array<{ code: string; label: string; description: string }> = [
  { code: 'SOF', label: 'Sofrível', description: 'Peça bastante desgastada, com detalhes muito reduzidos.' },
  {
    code: 'REG',
    label: 'Regular',
    description: 'Desgaste acentuado, com parte significativa dos detalhes comprometida.',
  },
  {
    code: 'BC',
    label: 'Bela Conservação',
    description: 'Sinais de circulação evidentes, mas com detalhes principais ainda identificáveis.',
  },
  {
    code: 'MBC',
    label: 'Muito Bem Conservada',
    description: 'Detalhes principais bem preservados, com sinais moderados de circulação.',
  },
  { code: 'SOB', label: 'Soberba', description: 'Excelente conservação, com mínimos sinais de circulação.' },
  {
    code: 'FC',
    label: 'Flor de Cunho',
    description: 'Conservação excepcional, praticamente sem sinais de circulação.',
  },
  {
    code: 'PROOF',
    label: 'Proof',
    description: 'Cunhagem especial para colecionadores, acabamento espelhado — não destinada à circulação.',
  },
]

const GRADE_SHELDON_HELP: Array<{ range: string; description: string }> = [
  { range: 'Poor · Fair · About Good · Good', description: 'Desgaste severo; só o tipo básico é identificável.' },
  { range: 'Very Good · Fine', description: 'Desgaste significativo, mas com os detalhes principais visíveis.' },
  { range: 'Very Fine', description: 'Desgaste moderado; a maior parte dos detalhes ainda nítida.' },
  { range: 'Extremely Fine', description: 'Desgaste leve; quase todos os detalhes preservados.' },
  { range: 'About Uncirculated', description: 'Traços mínimos de manuseio, sem desgaste de circulação real.' },
  {
    range: 'Mint State (60–70)',
    description: 'Sem circulação — o número indica o grau de perfeição, do mais baixo (60) ao mais alto (70).',
  },
]

function toNullableNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function toNullableInt(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function toNullableText(value: string): string | null {
  return value.trim() === '' ? null : value
}

/** UI trabalha com pureza em porcentagem (0–100); o banco guarda fração (0–1]. */
function purityToPercentString(purity: number | null): string {
  return purity !== null ? String(purity * 100) : ''
}

function percentStringToPurity(value: string): number | null {
  const percent = toNullableNumber(value)
  return percent !== null ? percent / 100 : null
}

/**
 * Data local de hoje em "AAAA-MM-DD" para pré-preencher `<input
 * type="date">`. `getFullYear`/`getMonth`/`getDate` já retornam os
 * componentes no fuso horário LOCAL do navegador — ao contrário de
 * `new Date("AAAA-MM-DD").toLocaleDateString()` (bug já corrigido em
 * outro lugar do projeto), aqui não há nenhuma string sendo
 * reinterpretada como UTC, então não há deslocamento de dia possível.
 */
function getTodayDateString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const CURRENT_YEAR = new Date().getFullYear()
/** Ano numismático mínimo aceito pelo campo — ver relatório sobre a escolha. */
const MIN_COIN_YEAR = 1
/** Pequena margem para moedas comemorativas cunhadas com o ano seguinte. */
const MAX_COIN_YEAR = CURRENT_YEAR + 1

function SectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
        <Icon className="size-3.5" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-text-primary">{children}</h3>
    </div>
  )
}

/** Duas colunas no desktop, uma coluna no mobile — usado para pares de campos do formulário. */
function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}

/**
 * Avaliação pessoal (1-5 estrelas), não a conservação numismática. `null`
 * = não avaliado, nenhuma estrela preenchida. Clicar na estrela já
 * selecionada limpa a avaliação de volta para `null` (toggle), evitando
 * a necessidade de um botão "limpar" separado.
 */
function StarRatingInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (rating: number | null) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Avaliação pessoal">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === star ? null : star)}
          aria-label={`${star} estrela${star === 1 ? '' : 's'}`}
          aria-pressed={value !== null && star <= value}
          className="p-0.5 text-text-secondary/40 transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
        >
          <Star className={`size-4 ${value !== null && star <= value ? 'fill-accent text-accent' : ''}`} aria-hidden />
        </button>
      ))}
    </div>
  )
}

type CoinImageSlotStatus = 'loading' | 'idle' | 'processing' | 'uploading' | 'saved' | 'error'

const SLOT_STATUS_LABEL: Partial<Record<CoinImageSlotStatus, string>> = {
  processing: 'Processando...',
  uploading: 'Enviando...',
  saved: 'Salvo',
}

/**
 * Uma foto (frente/verso/borda) de um exemplar. Estado próprio e
 * independente por slot — cada quadro busca/faz upload/exclui sua
 * própria imagem sem afetar os outros dois. Nunca mostra "Salvo" antes
 * do upload E da gravação dos metadados terem os dois confirmado
 * sucesso (ver CoinImagesRepository.upload).
 */
function CoinImageSlot({ collectionUnitId, kind }: { collectionUnitId: string; kind: CoinImageKind }) {
  const [image, setImage] = useState<CoinImage | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<CoinImageSlotStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')
      setError(null)
      try {
        const existing = await coinImagesRepository.getByUnitAndKind(collectionUnitId, kind)
        if (cancelled) return
        setImage(existing)
        if (existing) {
          const url = await coinImagesRepository.getSignedUrl(existing.storagePath)
          if (!cancelled) setPreviewUrl(url)
        } else {
          setPreviewUrl(null)
        }
        if (!cancelled) setStatus('idle')
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
          setStatus('error')
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [collectionUnitId, kind])

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setStatus('processing')

    try {
      const processed = await processCoinImage(file, kind)
      setStatus('uploading')
      const uploaded = await coinImagesRepository.upload(collectionUnitId, {
        kind,
        blob: processed.blob,
        width: processed.width,
        height: processed.height,
      })
      const url = await coinImagesRepository.getSignedUrl(uploaded.storagePath)
      setImage(uploaded)
      setPreviewUrl(url)
      setStatus('saved')
      setTimeout(() => setStatus((current) => (current === 'saved' ? 'idle' : current)), 1500)
    } catch (err) {
      const message =
        err instanceof UnsupportedImageFormatError || err instanceof ImageTooLargeError
          ? err.message
          : (err as Error).message
      setError(message)
      setStatus('error')
    }
  }

  async function handleRemove() {
    if (!image) return
    const confirmed = window.confirm(`Excluir a foto de ${COIN_IMAGE_KIND_LABELS[kind].toLowerCase()}?`)
    if (!confirmed) return

    setError(null)
    try {
      await coinImagesRepository.remove(image)
      setImage(null)
      setPreviewUrl(null)
      setStatus('idle')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const isBusy = status === 'processing' || status === 'uploading'

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      {image && previewUrl ? (
        <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-background">
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-label={`Ver foto de ${COIN_IMAGE_KIND_LABELS[kind]} ampliada`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL temporária, não é asset estático do Next */}
            <img src={previewUrl} alt={`Foto de ${COIN_IMAGE_KIND_LABELS[kind]}`} className="size-full object-cover" />
          </button>

          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-background/80 p-1.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isBusy}
              aria-label="Substituir foto"
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <RefreshCcw className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={isBusy}
              aria-label="Excluir foto"
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>

          {isBusy && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
          className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-text-secondary transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {isBusy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
          <span className="text-[11px] font-medium">Adicionar foto</span>
        </button>
      )}

      <p className="text-center text-xs font-medium text-text-secondary">{COIN_IMAGE_KIND_LABELS[kind]}</p>

      {status !== 'idle' && status !== 'loading' && status !== 'error' && SLOT_STATUS_LABEL[status] && (
        <p className="text-center text-[11px] text-text-secondary/70">{SLOT_STATUS_LABEL[status]}</p>
      )}
      {error && <p className="text-center text-[11px] text-danger">{error}</p>}

      <Modal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={`Foto de ${COIN_IMAGE_KIND_LABELS[kind]}`}
      >
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL temporária
          <img src={previewUrl} alt={`Foto de ${COIN_IMAGE_KIND_LABELS[kind]}`} className="w-full rounded-lg" />
        )}
      </Modal>
    </div>
  )
}

export default function CollectionPage() {
  const [items, setItems] = useState<CollectionItem[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [metals, setMetals] = useState<Metal[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isGradeHelpOpen, setIsGradeHelpOpen] = useState(false)

  // Busca e filtros — somente client-side, sobre os itens já carregados.
  // Não há filtro por conservação: desde que ela passou a ser propriedade de
  // cada exemplar (collection_units), não existe mais um valor único por
  // moeda para filtrar — ver relatório da etapa.
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterMetal, setFilterMetal] = useState('')

  /** `null` = modal em modo "adicionar"; caso contrário, id do item em edição. */
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  /** Quantidade mínima aceita no campo — 1 ao criar, quantidade atual ao editar (nunca reduz por aqui). */
  const [minQuantity, setMinQuantity] = useState(1)

  // Informações da moeda
  const [countryCode, setCountryCode] = useState('')
  const [year, setYear] = useState('')
  const [denomination, setDenomination] = useState('')
  const [hasSecondMetal, setHasSecondMetal] = useState(false)
  const [metalCode, setMetalCode] = useState('')
  const [secondaryMetalCode, setSecondaryMetalCode] = useState('')

  // Características
  const [grossWeightG, setGrossWeightG] = useState('')
  const [purityPercent, setPurityPercent] = useState('')
  /** Conservação inicial dos exemplares criados agora — só se aplica ao ADICIONAR (ver seção 2/4 da etapa). */
  const [initialGradeId, setInitialGradeId] = useState('')
  const [faceValue, setFaceValue] = useState('')
  const [quantity, setQuantity] = useState('1')

  // Aquisição
  const [pricePaid, setPricePaid] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [notes, setNotes] = useState('')

  // Modal de exemplares (collection_units) de uma moeda específica
  const [unitsModalItem, setUnitsModalItem] = useState<CollectionItem | null>(null)
  const [units, setUnits] = useState<CollectionUnit[]>([])
  const [isUnitsLoading, setIsUnitsLoading] = useState(false)
  const [unitsError, setUnitsError] = useState<string | null>(null)
  /** Exemplar aguardando confirmação explícita de exclusão (nunca excluído direto no clique). */
  const [unitPendingDelete, setUnitPendingDelete] = useState<CollectionUnit | null>(null)

  useEffect(() => {
    Promise.all([
      collectionRepository.list(),
      referenceRepository.listCountries(),
      referenceRepository.listMetals(),
      referenceRepository.listGrades(),
    ])
      .then(([itemsResult, countriesResult, metalsResult, gradesResult]) => {
        setItems(itemsResult)
        setCountries(countriesResult)
        setMetals(metalsResult)
        setGrades(gradesResult)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  const gradesByScale = grades.reduce<Record<string, Grade[]>>((groups, grade) => {
    ;(groups[grade.scale] ??= []).push(grade)
    return groups
  }, {})

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()

    return items.filter((item) => {
      if (filterCountry && item.countryCode !== filterCountry) return false
      if (filterMetal && item.metalCode !== filterMetal) return false

      if (term === '') return true

      const haystack = [item.denomination, item.countryDisplayName, item.metalName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(term)
    })
  }, [items, searchTerm, filterCountry, filterMetal])

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)

  function resetForm() {
    setCountryCode('')
    setYear('')
    setDenomination('')
    setHasSecondMetal(false)
    setMetalCode('')
    setSecondaryMetalCode('')
    setGrossWeightG('')
    setPurityPercent('')
    setInitialGradeId('')
    setFaceValue('')
    setQuantity('1')
    setMinQuantity(1)
    setPricePaid('')
    setPurchaseDate('')
    setSellerName('')
    setNotes('')
  }

  function openAddModal() {
    setError(null)
    setSuccessMessage(null)
    setEditingItemId(null)
    resetForm()
    // Só ao adicionar — editar preserva a data já registrada da compra.
    setPurchaseDate(getTodayDateString())
    setIsModalOpen(true)
  }

  function openEditModal(item: CollectionItem) {
    setError(null)
    setSuccessMessage(null)
    setEditingItemId(item.id)
    setCountryCode(item.countryCode ?? '')
    setYear(item.year !== null ? String(item.year) : '')
    setDenomination(item.denomination ?? '')
    setHasSecondMetal(item.secondaryMetalCode !== null)
    setMetalCode(item.metalCode ?? '')
    setSecondaryMetalCode(item.secondaryMetalCode ?? '')
    setGrossWeightG(item.grossWeightG !== null ? String(item.grossWeightG) : '')
    setPurityPercent(purityToPercentString(item.purity))
    setInitialGradeId('')
    setFaceValue(item.faceValue !== null ? String(item.faceValue) : '')
    setQuantity(String(item.quantity))
    setMinQuantity(item.quantity)
    setPricePaid(item.purchase !== null ? String(item.purchase.totalPrice) : '')
    setPurchaseDate(item.purchase?.purchaseDate ?? '')
    setSellerName(item.purchase?.sellerName ?? '')
    setNotes(item.purchase?.notes ?? '')
    setIsModalOpen(true)
  }

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingItemId(null)
    resetForm()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    setError(null)

    const parsedQuantity = Number.parseInt(quantity, 10)
    const normalizedQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1

    if (editingItemId !== null && normalizedQuantity < minQuantity) {
      setError('Para reduzir a quantidade, exclua os exemplares individualmente na lista de exemplares da moeda.')
      return
    }

    setIsSaving(true)

    const totalPrice = toNullableNumber(pricePaid)

    const input = {
      countryCode: toNullableText(countryCode),
      year: toNullableInt(year),
      denomination: toNullableText(denomination),
      metalCode: toNullableText(metalCode),
      secondaryMetalCode: hasSecondMetal ? toNullableText(secondaryMetalCode) : null,
      grossWeightG: toNullableNumber(grossWeightG),
      purity: percentStringToPurity(purityPercent),
      faceValue: toNullableNumber(faceValue),
      quantity: normalizedQuantity,
      initialGradeId: toNullableText(initialGradeId),
      purchase:
        totalPrice !== null
          ? {
              totalPrice,
              purchaseDate: toNullableText(purchaseDate),
              sellerName: toNullableText(sellerName),
              sellerContact: null,
              notes: toNullableText(notes),
            }
          : null,
    }

    try {
      if (editingItemId === null) {
        const newItem = await collectionRepository.create(input)
        setItems((current) => [newItem, ...current])
        setSuccessMessage('Moeda adicionada com sucesso.')
      } else {
        const updatedItem = await collectionRepository.update(editingItemId, input)
        setItems((current) => current.map((item) => (item.id === updatedItem.id ? updatedItem : item)))
        setSuccessMessage('Moeda atualizada com sucesso.')
      }

      closeModal()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm('Tem certeza que deseja excluir esta moeda? Todos os exemplares serão removidos.')
    if (!confirmed) return

    setError(null)

    try {
      await collectionRepository.remove(id)
      setItems((current) => current.filter((item) => item.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function openUnitsModal(item: CollectionItem) {
    setUnitsError(null)
    setUnitsModalItem(item)
    setIsUnitsLoading(true)

    try {
      const result = await collectionUnitsRepository.listByItem(item.id)
      setUnits(result)
    } catch (err) {
      setUnitsError((err as Error).message)
    } finally {
      setIsUnitsLoading(false)
    }
  }

  function closeUnitsModal() {
    setUnitsModalItem(null)
    setUnits([])
    setUnitsError(null)
  }

  async function handleUnitFieldChange(
    unit: CollectionUnit,
    changes: Partial<{ gradeId: string | null; status: CollectionUnitStatus; rating: number | null }>,
  ) {
    setUnitsError(null)

    try {
      const updated = await collectionUnitsRepository.update(unit.id, {
        gradeId: changes.gradeId !== undefined ? changes.gradeId : unit.gradeId,
        status: changes.status ?? unit.status,
        rating: changes.rating !== undefined ? changes.rating : unit.rating,
      })
      setUnits((current) => current.map((u) => (u.id === updated.id ? updated : u)))
    } catch (err) {
      setUnitsError((err as Error).message)
    }
  }

  /** Abre a confirmação — a exclusão em si só acontece em `confirmUnitDelete`. */
  function handleUnitDelete(unit: CollectionUnit) {
    setUnitPendingDelete(unit)
  }

  async function confirmUnitDelete() {
    const unit = unitPendingDelete
    if (!unit) return

    setUnitsError(null)

    try {
      await collectionUnitsRepository.remove(unit.id)
      setUnits((current) => current.filter((u) => u.id !== unit.id))
      setItems((current) =>
        current.map((item) =>
          item.id === unit.collectionItemId ? { ...item, quantity: item.quantity - 1 } : item,
        ),
      )
      setUnitsModalItem((current) => (current ? { ...current, quantity: current.quantity - 1 } : current))
      setUnitPendingDelete(null)
    } catch (err) {
      // Inclui a mensagem amigável de "último exemplar" vinda do banco (P0001).
      // Fecha a confirmação para o erro ficar visível no modal de exemplares por trás.
      setUnitPendingDelete(null)
      setUnitsError((err as Error).message)
    }
  }

  const hasActiveFilters = searchTerm !== '' || filterCountry !== '' || filterMetal !== ''

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Minha Coleção"
        description="Organize e acompanhe suas moedas."
        actions={
          <Button type="button" onClick={openAddModal}>
            <Plus className="size-4" aria-hidden />
            Adicionar moeda
          </Button>
        }
      />

      {error && <p className="text-sm text-danger">{error}</p>}
      {successMessage && <p className="text-sm text-success">{successMessage}</p>}

      {items.length > 0 && (
        <>
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{items.length}</span> moeda
            {items.length === 1 ? '' : 's'} <span className="text-text-secondary/50">·</span>{' '}
            <span className="font-medium text-text-primary">{totalUnits}</span> unidade
            {totalUnits === 1 ? '' : 's'}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
                aria-hidden
              />
              <Input
                placeholder="Buscar por denominação, país, metal..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-auto sm:shrink-0">
              <Select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                aria-label="Filtrar por país"
              >
                <option value="">País</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flagEmoji ? `${country.flagEmoji} ` : ''}
                    {country.name}
                  </option>
                ))}
              </Select>
              <Select
                value={filterMetal}
                onChange={(e) => setFilterMetal(e.target.value)}
                aria-label="Filtrar por metal"
              >
                <option value="">Metal</option>
                {metals.map((metal) => (
                  <option key={metal.code} value={metal.code}>
                    {metal.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </>
      )}

      {isLoading ? (
        <p className="text-sm text-text-secondary">Carregando...</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Sua coleção ainda está vazia"
          description="Comece cadastrando sua primeira moeda."
          action={
            <Button type="button" onClick={openAddModal}>
              <Plus className="size-4" aria-hidden />
              Adicionar primeira moeda
            </Button>
          }
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhuma moeda encontrada"
          description={hasActiveFilters ? 'Ajuste a busca ou os filtros para ver mais resultados.' : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <Card key={item.id} hoverable className="flex flex-col overflow-hidden">
              <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-surface-hover to-surface text-text-secondary">
                <Coins className="size-9 opacity-30" aria-hidden />
                <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-wide text-text-secondary/70 uppercase">
                  Sem imagem
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-3.5 p-4">
                <div>
                  <p className="font-semibold text-text-primary">{item.denomination ?? 'Sem denominação'}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {item.countryFlagEmoji ? `${item.countryFlagEmoji} ` : ''}
                    {item.countryDisplayName ?? item.countryCode ?? '—'} · {item.year ?? '—'}
                  </p>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {item.metalName && (
                      <Badge tone="accent">
                        {item.secondaryMetalName ? `${item.metalName} + ${item.secondaryMetalName}` : item.metalName}
                      </Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openUnitsModal(item)}
                    className="flex shrink-0 items-center gap-1 rounded text-xs font-medium text-accent transition-colors hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <Layers className="size-3.5" aria-hidden />
                    {item.quantity} exemplar{item.quantity === 1 ? '' : 'es'}
                  </button>
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-border pt-3.5">
                  <div>
                    <p className="text-xs text-text-secondary">Preço de aquisição</p>
                    <p className="font-semibold text-text-primary">
                      {item.purchase ? `R$ ${item.purchase.totalPrice.toFixed(2)}` : '—'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      aria-label="Editar moeda"
                      className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label="Excluir moeda"
                      className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingItemId === null ? 'Adicionar moeda' : 'Editar moeda'}
        description="Preencha os dados da moeda para adicioná-la à sua coleção."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" form="coin-form" isLoading={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar'}
            </Button>
          </>
        }
      >
        <form id="coin-form" onSubmit={handleSubmit} className="flex flex-col gap-7">
          <div className="flex flex-col gap-4">
            <SectionHeading icon={Landmark}>Informações da moeda</SectionHeading>

            <FieldRow>
              <Select label="País" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} required>
                <option value="">Selecione...</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flagEmoji ? `${country.flagEmoji} ` : ''}
                    {country.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Ano"
                type="number"
                inputMode="numeric"
                min={MIN_COIN_YEAR}
                max={MAX_COIN_YEAR}
                step={1}
                placeholder={`Ex.: 1900`}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </FieldRow>

            <Input
              label="Denominação"
              value={denomination}
              onChange={(e) => setDenomination(e.target.value)}
              placeholder="Ex.: 200 Réis"
            />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text-secondary">Composição</span>
              <div className="flex gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                  <input
                    type="radio"
                    name="metal-composition"
                    checked={!hasSecondMetal}
                    onChange={() => setHasSecondMetal(false)}
                    className="accent-accent"
                  />
                  Um metal
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                  <input
                    type="radio"
                    name="metal-composition"
                    checked={hasSecondMetal}
                    onChange={() => setHasSecondMetal(true)}
                    className="accent-accent"
                  />
                  Dois metais
                </label>
              </div>
            </div>

            <FieldRow>
              <Select
                label={hasSecondMetal ? 'Metal principal' : 'Metal'}
                value={metalCode}
                onChange={(e) => setMetalCode(e.target.value)}
              >
                <option value="">Selecione...</option>
                {metals.map((metal) => (
                  <option key={metal.code} value={metal.code}>
                    {metal.name}
                  </option>
                ))}
              </Select>
              {hasSecondMetal && (
                <Select
                  label="Segundo metal"
                  value={secondaryMetalCode}
                  onChange={(e) => setSecondaryMetalCode(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {metals.map((metal) => (
                    <option key={metal.code} value={metal.code}>
                      {metal.name}
                    </option>
                  ))}
                </Select>
              )}
            </FieldRow>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-6">
            <SectionHeading icon={ClipboardList}>Características</SectionHeading>

            <FieldRow>
              <Input
                label="Peso (g)"
                type="number"
                step="any"
                min="0"
                value={grossWeightG}
                onChange={(e) => setGrossWeightG(e.target.value)}
              />
              <Input
                label="Pureza (%)"
                type="number"
                step="any"
                min="0"
                max="100"
                value={purityPercent}
                onChange={(e) => setPurityPercent(e.target.value)}
                placeholder="Ex.: 90"
              />
            </FieldRow>

            <FieldRow>
              {editingItemId === null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="grade-select" className="text-sm font-medium text-text-secondary">
                      Conservação inicial
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsGradeHelpOpen(true)}
                      aria-label="Ajuda sobre níveis de conservação"
                      className="flex size-4 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <HelpCircle className="size-4" aria-hidden />
                    </button>
                  </div>
                  <Select id="grade-select" value={initialGradeId} onChange={(e) => setInitialGradeId(e.target.value)}>
                    <option value="">Selecione...</option>
                    {Object.entries(gradesByScale).map(([scale, scaleGrades]) => (
                      <optgroup key={scale} label={GRADE_SCALE_LABELS[scale] ?? scale}>
                        {scaleGrades.map((grade) => (
                          <option key={grade.id} value={grade.id}>
                            {grade.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <p className="text-xs text-text-secondary/70">Aplicada a todos os exemplares criados agora.</p>
                </div>
              )}
              <Input
                label="Valor de face"
                type="number"
                step="any"
                min="0"
                value={faceValue}
                onChange={(e) => setFaceValue(e.target.value)}
              />
            </FieldRow>

            <FieldRow>
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Quantidade"
                  type="number"
                  min={minQuantity}
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
                {editingItemId !== null && (
                  <p className="text-xs text-text-secondary/70">
                    Para reduzir, exclua exemplares na lista de exemplares da moeda.
                  </p>
                )}
              </div>
            </FieldRow>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-6">
            <SectionHeading icon={Receipt}>Aquisição</SectionHeading>

            <FieldRow>
              <Input
                label="Preço pago"
                type="number"
                step="any"
                min="0"
                value={pricePaid}
                onChange={(e) => setPricePaid(e.target.value)}
              />
              <Input
                label="Data da compra"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </FieldRow>

            <FieldRow>
              <Input label="Vendedor" value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
            </FieldRow>

            <Textarea
              label="Observação"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalhes adicionais sobre a moeda ou a compra"
            />
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isGradeHelpOpen}
        onClose={() => setIsGradeHelpOpen(false)}
        title="Níveis de conservação"
        description="O que cada sigla significa, nas duas escalas usadas no Numora."
      >
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
              Escala brasileira
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              {GRADE_BR_HELP.map((entry) => (
                <div key={entry.code}>
                  <dt className="text-sm font-medium text-text-primary">
                    {entry.code} — {entry.label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-text-secondary">{entry.description}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="border-t border-border pt-5">
            <p className="text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
              Escala Sheldon (internacional)
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              {GRADE_SHELDON_HELP.map((entry) => (
                <div key={entry.range}>
                  <dt className="text-sm font-medium text-text-primary">{entry.range}</dt>
                  <dd className="mt-0.5 text-sm text-text-secondary">{entry.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={unitsModalItem !== null}
        onClose={closeUnitsModal}
        title={unitsModalItem?.denomination ?? 'Exemplares'}
        description={
          unitsModalItem
            ? `${unitsModalItem.countryDisplayName ?? unitsModalItem.countryCode ?? '—'}${
                unitsModalItem.year !== null ? ` · ${unitsModalItem.year}` : ''
              } — você possui ${unitsModalItem.quantity} exemplar${unitsModalItem.quantity === 1 ? '' : 'es'}`
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          {unitsError && <p className="text-sm text-danger">{unitsError}</p>}

          {isUnitsLoading ? (
            <p className="text-sm text-text-secondary">Carregando exemplares...</p>
          ) : units.length === 0 ? (
            <p className="text-sm text-text-secondary">Este registro não possui exemplares.</p>
          ) : (
            units.map((unit, index) => (
              <div key={unit.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-text-primary">
                    Exemplar #{index + 1}
                    <span className="ml-2 font-mono text-xs font-normal text-text-secondary/50">
                      {unit.id.slice(0, 8)}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => handleUnitDelete(unit)}
                    aria-label="Excluir exemplar"
                    className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Imagens do exemplar</span>
                  <div className="grid grid-cols-3 gap-2.5">
                    {COIN_IMAGE_KINDS.map((kind) => (
                      <CoinImageSlot key={kind} collectionUnitId={unit.id} kind={kind} />
                    ))}
                  </div>
                </div>

                <FieldRow>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-sm font-medium text-text-secondary">Conservação</label>
                      <button
                        type="button"
                        onClick={() => setIsGradeHelpOpen(true)}
                        aria-label="Ajuda sobre níveis de conservação"
                        className="flex size-4 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        <HelpCircle className="size-4" aria-hidden />
                      </button>
                    </div>
                    <Select
                      value={unit.gradeId ?? ''}
                      onChange={(e) => handleUnitFieldChange(unit, { gradeId: toNullableText(e.target.value) })}
                    >
                      <option value="">Não informada</option>
                      {Object.entries(gradesByScale).map(([scale, scaleGrades]) => (
                        <optgroup key={scale} label={GRADE_SCALE_LABELS[scale] ?? scale}>
                          {scaleGrades.map((grade) => (
                            <option key={grade.id} value={grade.id}>
                              {grade.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </div>

                  <Select
                    label="Status"
                    value={unit.status}
                    onChange={(e) =>
                      handleUnitFieldChange(unit, { status: e.target.value as CollectionUnitStatus })
                    }
                  >
                    {COLLECTION_UNIT_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_EMOJI[status]} {COLLECTION_UNIT_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                </FieldRow>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text-secondary">Avaliação pessoal</span>
                  <StarRatingInput
                    value={unit.rating}
                    onChange={(rating) => handleUnitFieldChange(unit, { rating })}
                  />
                  <p className="text-xs text-text-secondary/70">
                    Avaliação pessoal do exemplar. Não representa a conservação.
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal
        isOpen={unitPendingDelete !== null}
        onClose={() => setUnitPendingDelete(null)}
        title="Excluir este exemplar?"
        description="Esta ação removerá apenas este exemplar da coleção — a moeda e os demais exemplares não são afetados."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setUnitPendingDelete(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={confirmUnitDelete}>
              Excluir exemplar
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </div>
  )
}
