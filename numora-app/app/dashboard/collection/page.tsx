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

import Link from 'next/link'
import { useCallback, useEffect, useRef, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowUpDown,
  Award,
  Bookmark,
  Camera,
  Check,
  Circle,
  Coins,
  ClipboardList,
  Eye,
  EyeOff,
  FolderTree,
  HelpCircle,
  Info,
  Landmark,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Pencil,
  PackageOpen,
  Plus,
  Receipt,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'

import { createSupabaseCollectionRepository } from '@/features/collection/repositories/collection.repository'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import {
  getItemAcquisitionSummary,
  getItemAcquisitionTotal,
  getItemPurchaseIds,
} from '@/features/collection/aggregate'
import { createSupabaseCollectionUnitsRepository } from '@/features/collection-units/repositories/collection-units.repository'
import { createSupabaseCoinImagesRepository } from '@/features/coin-images/repositories/coin-images.repository'
import type {
  CatalogReference,
  CollectionItem,
  CollectionItemEnrichmentInput,
  CollectionItemUnit,
  Country,
  Grade,
  Metal,
} from '@/features/collection/types'
import {
  COLLECTION_UNIT_STATUS_EMOJI,
  COLLECTION_UNIT_STATUS_LABELS,
  COLLECTION_UNIT_STATUS_OPTIONS,
  type CollectionUnit,
  type CollectionUnitStatus,
} from '@/features/collection-units/types'
import { COIN_IMAGE_KINDS, COIN_IMAGE_KIND_LABELS, type CoinImage, type CoinImageKind } from '@/features/coin-images/types'
import { OUTPUT_SIZE, encodeCroppedCoinImage, UnsupportedImageFormatError, ImageTooLargeError } from '@/lib/images/process-coin-image'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { IconButton } from '@/components/ui/IconButton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CoinImageEditor } from '@/components/ui/CoinImageEditor'
import { CoinImageViewer } from '@/components/ui/CoinImageViewer'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { cn } from '@/components/ui/utils'

const collectionRepository = createSupabaseCollectionRepository()
const referenceRepository = createSupabaseReferenceRepository()
const collectionUnitsRepository = createSupabaseCollectionUnitsRepository()
const coinImagesRepository = createSupabaseCoinImagesRepository()

/** Indicador visual rápido por status, usado na lista de exemplares (seção 12/13 da etapa). */
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

// ---------------------------------------------------------------------------
// Etapa 10 — busca, filtros, ordenação e agrupamento (Numora Collection
// Experience). Tudo client-side sobre os itens já carregados por
// `collectionRepository.list()`, que desde esta etapa já embute
// `collection_units` (com `grades`) e os metadados leves de `coin_images`
// na mesma query — nenhuma consulta nova é disparada por busca/filtro/
// ordenação/agrupamento em si.
// ---------------------------------------------------------------------------

type ViewMode = 'grid' | 'list'
type SortOption = 'recent' | 'oldest' | 'yearAsc' | 'yearDesc' | 'denomination' | 'country' | 'value'
type GroupOption = 'none' | 'country' | 'metal' | 'period' | 'status'

const SORT_LABELS: Record<SortOption, string> = {
  recent: 'Mais recente adicionado',
  oldest: 'Mais antigo adicionado',
  yearAsc: 'Ano crescente',
  yearDesc: 'Ano decrescente',
  denomination: 'Denominação (A–Z)',
  country: 'País (A–Z)',
  value: 'Maior valor de aquisição',
}

const GROUP_LABELS: Record<GroupOption, string> = {
  none: 'Sem agrupamento',
  country: 'País',
  metal: 'Metal',
  period: 'Período',
  status: 'Status do exemplar',
}

/** `null` sempre por último, independente da direção — evita que "sem informação" pareça o menor/maior valor real. */
function compareNullableString(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, 'pt-BR')
}

function compareNullableNumber(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction * (a - b)
}

const SORTERS: Record<SortOption, (a: CollectionItem, b: CollectionItem) => number> = {
  recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  yearAsc: (a, b) => compareNullableNumber(a.year, b.year, 1),
  yearDesc: (a, b) => compareNullableNumber(a.year, b.year, -1),
  denomination: (a, b) => compareNullableString(a.denomination, b.denomination),
  country: (a, b) => compareNullableString(a.countryDisplayName ?? a.countryCode, b.countryDisplayName ?? b.countryCode),
  // Etapa 15.4: soma real de collection_units.unit_cost dos exemplares do
  // item — nunca mais item.purchase?.totalPrice (legado, só a 1ª compra).
  // Nunca `null` (getItemAcquisitionTotal soma 0 para exemplares sem
  // custo conhecido), então nem precisa de compareNullableNumber aqui.
  value: (a, b) => getItemAcquisitionTotal(b) - getItemAcquisitionTotal(a),
}

interface GroupEntry {
  key: string
  label: string
  items: CollectionItem[]
}

/** Chave usada para os grupos "sem informação" (sem país/metal/ano/exemplar) — sempre exibidos por último. */
const GROUP_NONE_KEY = '__none'

/**
 * Avaliação pessoal compacta (só leitura), usada nos resumos de exemplar
 * da lista de moedas — não confundir com `StarRatingInput`, que é
 * interativo e vive no modal de edição de exemplares.
 */
function MiniStars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="text-[11px] text-text-secondary/50">Sem avaliação</span>
  }
  return (
    <span className="flex items-center gap-0.5" aria-label={`Avaliação pessoal: ${rating} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-3 ${n <= rating ? 'fill-accent text-accent' : 'text-text-secondary/25'}`} aria-hidden />
      ))}
    </span>
  )
}

/**
 * Exemplar principal do item (Etapa 10) — fonte de verdade é
 * `unit.isPrimary`, nunca mais a antiga convenção "mais antigo = principal".
 * O fallback para `units[0]` (que `CollectionRepository` sempre ordena por
 * `createdAt` ascendente) só existe para o caso defensivo de um item chegar
 * sem nenhum principal marcado — não deveria acontecer dado o backfill +
 * o índice único parcial no banco, mas a UI nunca fica sem exemplar
 * nenhum para representar a moeda.
 */
function getPrimaryUnit(item: CollectionItem): CollectionItemUnit | null {
  return item.units.find((u) => u.isPrimary) ?? item.units[0] ?? null
}

/**
 * Miniatura do card (Etapa 11) — mostra UMA imagem do exemplar PRINCIPAL
 * por vez (nunca Frente+Verso+Borda simultâneas — isso dava aparência de
 * "slab"). Frente é a preferida por padrão; se o principal tiver mais de
 * um tipo de foto, pills discretas por cima da imagem alternam entre
 * elas sem nova request (as até 3 URLs já vêm no mesmo lote de
 * `neededThumbPaths`). Sem foto nenhuma, a área inteira vira o CTA
 * "+ Adicionar foto", que abre o fluxo focado do exemplar principal —
 * sem o usuário precisar descobrir que "N exemplares" existe.
 *
 * `compact`: na visão Lista (miniatura de 56px) as pills de troca não
 * caberiam de forma legível/tocável — nesse modo mostra só a imagem
 * efetiva (ainda clicável) e o CTA vira só o ícone, sem texto.
 */
function CollectionItemThumbnail({
  item,
  thumbUrls,
  onOpenViewer,
  onAddPhoto,
  compact = false,
}: {
  item: CollectionItem
  thumbUrls: Record<string, string>
  onOpenViewer: (units: CollectionUnit[], unitId: string, kind: CoinImageKind) => void
  onAddPhoto: (item: CollectionItem, primaryUnit: CollectionItemUnit) => void
  compact?: boolean
}) {
  const [requestedKind, setRequestedKind] = useState<CoinImageKind>('front')
  const primaryUnit = getPrimaryUnit(item)
  const images = primaryUnit?.images ?? []

  if (!primaryUnit || images.length === 0) {
    return (
      <button
        type="button"
        onClick={() => primaryUnit && onAddPhoto(item, primaryUnit)}
        disabled={!primaryUnit}
        className="flex size-full flex-col items-center justify-center gap-1.5 text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label={`Adicionar foto — ${item.denomination ?? 'moeda sem denominação'}`}
      >
        <Camera className={compact ? 'size-5 opacity-60' : 'size-7 opacity-60'} aria-hidden />
        {!compact && <span className="text-xs font-medium text-accent">+ Adicionar foto</span>}
      </button>
    )
  }

  // Se a última escolha do usuário não existir mais para este item (ex.:
  // trocou de card, ou a foto foi removida), cai de volta para
  // frente/primeira disponível — nunca guarda um kind "morto" no estado.
  const effectiveKind: CoinImageKind = images.some((image) => image.kind === requestedKind)
    ? requestedKind
    : (images.find((image) => image.kind === 'front')?.kind ?? images[0].kind)

  const currentImage = images.find((image) => image.kind === effectiveKind)
  const url = currentImage ? thumbUrls[currentImage.storagePath] : undefined

  return (
    <div className="relative size-full">
      <button
        type="button"
        onClick={() => onOpenViewer(item.units, primaryUnit.id, effectiveKind)}
        className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label={`Ver foto de ${COIN_IMAGE_KIND_LABELS[effectiveKind]} do exemplar principal — ${item.denomination ?? 'moeda sem denominação'}`}
      >
        {url ? (
          effectiveKind === 'edge' ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL temporária, não é asset estático do Next
            <img
              src={url}
              alt={`${COIN_IMAGE_KIND_LABELS[effectiveKind]} do exemplar principal — ${item.denomination ?? 'moeda'}`}
              className="size-full object-cover"
            />
          ) : (
            // Frente/Verso (Etapa 11.1): apresentação circular só na tela — o
            // arquivo salvo continua quadrado (1200×1200, CoinImageEditor
            // shape="circle"); o guia circular do editor já toca as 4 bordas
            // desse quadrado, então uma máscara CSS pura no mesmo quadrado
            // reproduz exatamente o recorte visto ao enquadrar a foto, sem
            // reprocessar/gerar novo arquivo.
            <div className="flex size-full items-center justify-center bg-black">
              <div className="relative aspect-square h-full max-w-full overflow-hidden rounded-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL temporária, não é asset estático do Next */}
                <img
                  src={url}
                  alt={`${COIN_IMAGE_KIND_LABELS[effectiveKind]} do exemplar principal — ${item.denomination ?? 'moeda'}`}
                  className="size-full object-cover"
                />
              </div>
            </div>
          )
        ) : (
          <div className="flex size-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-text-secondary" aria-hidden />
          </div>
        )}
      </button>

      {!compact && images.length > 1 && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/55 to-transparent p-2"
          role="group"
          aria-label="Alternar foto exibida"
        >
          {COIN_IMAGE_KINDS.filter((kind) => images.some((image) => image.kind === kind)).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setRequestedKind(kind)
              }}
              aria-label={`Mostrar foto de ${COIN_IMAGE_KIND_LABELS[kind]}`}
              aria-pressed={kind === effectiveKind}
              className={cn(
                'pointer-events-auto rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                kind === effectiveKind ? 'bg-white text-background' : 'bg-white/30 text-white hover:bg-white/50',
              )}
            >
              {COIN_IMAGE_KIND_LABELS[kind].charAt(0)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Resumo por exemplar da visão GRID (Etapa 10, seção 7) — conservação,
 * status e avaliação de CADA exemplar, sem misturar dados entre eles.
 * Rolável além de poucos itens para não estourar a altura do card.
 *
 * Diferenciação visual (Etapa 11 — corrige risco de o usuário ler as
 * estrelas como conservação): `Bookmark` = Principal, `Award` =
 * Conservação, `Star` (via `MiniStars`) = SÓ avaliação pessoal, badge =
 * Status. Cada valor tem um glifo próprio, nenhum reaproveita o ícone de
 * outro.
 *
 * `onEditUnit` (Etapa "Editar Exemplar"): único affordance clicável da
 * linha — abre o modal focado naquele exemplar. Só existe na Grid de
 * propósito: a Lista mostra contagens agregadas (`ListStatusCounts`), não
 * uma linha por exemplar, então não há aqui "o exemplar" para apontar o
 * menu — nesse modo o caminho continua sendo "N exemplares" → "Gerenciar
 * exemplares", inalterado.
 */
function GridUnitSummary({
  units,
  onEditUnit,
}: {
  units: CollectionItemUnit[]
  onEditUnit: (unit: CollectionItemUnit, index: number) => void
}) {
  return (
    <div className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-0.5">
      {units.map((unit, index) => (
        <div
          key={unit.id}
          className="flex items-center gap-2 rounded-md bg-surface-hover/60 px-2 py-1 text-xs"
        >
          <span className="flex shrink-0 items-center gap-1 font-medium text-text-secondary">
            {unit.isPrimary && <Bookmark className="size-3 fill-accent text-accent" aria-hidden />}#{index + 1}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-text-secondary">
            <Award className="size-3 shrink-0 text-text-secondary/60" aria-hidden />
            <span className="truncate">{unit.gradeLabel ?? '—'}</span>
          </span>
          <MiniStars rating={unit.rating} />
          <Badge tone="neutral" className="shrink-0 whitespace-nowrap">
            {COLLECTION_UNIT_STATUS_EMOJI[unit.status]} {COLLECTION_UNIT_STATUS_LABELS[unit.status]}
          </Badge>
          <IconButton
            icon={MoreVertical}
            onClick={() => onEditUnit(unit, index)}
            aria-label={`Editar Exemplar #${index + 1}`}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Resumo compacto da visão LISTA (Etapa 10, seção 10) — contagem por
 * status em vez do detalhe exemplar-a-exemplar, para caber numa linha em
 * coleções grandes.
 */
function ListStatusCounts({ units }: { units: CollectionItemUnit[] }) {
  const counts = new Map<CollectionUnitStatus, number>()
  for (const unit of units) {
    counts.set(unit.status, (counts.get(unit.status) ?? 0) + 1)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {COLLECTION_UNIT_STATUS_OPTIONS.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => (
        <Badge key={status} tone="neutral" className="whitespace-nowrap">
          {COLLECTION_UNIT_STATUS_EMOJI[status]} {counts.get(status)}
        </Badge>
      ))}
    </div>
  )
}

/**
 * Valor de aquisição com olho de privacidade (Etapa 11) — `visible` vive
 * inteiramente no estado do componente pai (`visiblePurchaseIds`, só em
 * memória React); recarregar a página sempre volta a ocultar.
 *
 * Etapa 15.4: migrado de `item.purchase` (legado, só a 1ª compra do item)
 * para `getItemAcquisitionSummary(item)` (soma real de
 * `collection_units.unit_cost` dos exemplares) — dado já carregado junto
 * com o item, nenhuma query nova. Dois formatos, aprovados na Etapa 15.4:
 * exemplares com custo uniforme mostram um único valor (igual ao
 * comportamento de sempre, que cobre o caso comum de 1 compra só); custos
 * diferentes mostram "N exemplares · R$ total investidos" + "Custo médio"
 * — nunca mais um único valor que na verdade só refletia a 1ª compra. O
 * olho de privacidade continua ocultando só as cifras (nunca a contagem
 * de exemplares, que não é dado financeiro e já é exibida abertamente em
 * outros pontos do card).
 */
function PurchaseValue({
  item,
  visible,
  onToggle,
  align = 'left',
}: {
  item: CollectionItem
  visible: boolean
  onToggle: () => void
  align?: 'left' | 'right'
}) {
  const summary = getItemAcquisitionSummary(item)
  const hasValue = !(summary.isUniform && summary.uniformCost === null)
  const unitLabel = `${summary.activeUnitCount} exemplar${summary.activeUnitCount === 1 ? '' : 'es'}`

  const primaryText = !hasValue
    ? '—'
    : !visible
      ? summary.isUniform
        ? '••••••'
        : `${unitLabel} · ••••••`
      : summary.isUniform
        ? `R$ ${summary.uniformCost!.toFixed(2)}`
        : `${unitLabel} · R$ ${summary.totalInvested.toFixed(2)} investidos`

  return (
    <div className={cn('flex flex-col gap-0.5', align === 'right' && 'items-end')}>
      {summary.isUniform && <p className="text-xs text-text-secondary">Preço de aquisição</p>}
      <div className="flex items-center gap-1.5">
        <p className="font-semibold text-text-primary">{primaryText}</p>
        {hasValue && (
          <IconButton
            icon={visible ? Eye : EyeOff}
            size="sm"
            onClick={onToggle}
            aria-label={visible ? 'Ocultar valor de aquisição' : 'Mostrar valor de aquisição'}
          />
        )}
      </div>
      {hasValue && !summary.isUniform && visible && summary.averageCost !== null && (
        <p className="text-xs text-text-secondary">Custo médio: R$ {summary.averageCost.toFixed(2)}/exemplar</p>
      )}
    </div>
  )
}

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

/** Campos rastreados por `unitFieldSaveStatus` no modal "Editar Exemplar" (Etapa 12.1). */
type UnitFieldKey = 'gradeId' | 'status' | 'rating' | 'isPrimary'
type UnitFieldSaveStatus = 'saving' | 'saved' | 'error'

/**
 * Indicador contextual "Salvando.../✓ Salvo" (Etapa 12.1) — mesma
 * linguagem visual já usada por `SLOT_STATUS_LABEL`/"Foto salva" no
 * `CoinImageSlot`, só que por campo em vez de por foto. Altura reservada
 * mesmo quando `status` é `undefined` para o texto não empurrar o layout
 * ao aparecer/desaparecer.
 */
function UnitFieldSaveIndicator({ status }: { status?: UnitFieldSaveStatus }) {
  return (
    <div className="min-h-[15px]">
      {status === 'saving' && (
        <p className="flex items-center gap-1 text-[11px] text-text-secondary/70">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Salvando...
        </p>
      )}
      {status === 'saved' && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-success">
          <Check className="size-3" aria-hidden />
          Salvo
        </p>
      )}
      {status === 'error' && <p className="text-[11px] text-danger">Não foi possível salvar</p>}
    </div>
  )
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

/**
 * Só os estados transitórios (em andamento) têm mensagem própria — o
 * sucesso já fica visível de forma permanente no card da foto ("✓ Foto
 * salva"), então não repetimos a mesma informação aqui por baixo.
 */
const SLOT_STATUS_LABEL: Partial<Record<CoinImageSlotStatus, string>> = {
  processing: 'Processando foto...',
  uploading: 'Salvando foto...',
}

const COIN_IMAGE_EDITOR_CONFIG: Record<CoinImageKind, { shape: 'circle' | 'wide'; hint: string }> = {
  front: { shape: 'circle', hint: 'Centralize a moeda dentro do círculo.' },
  back: { shape: 'circle', hint: 'Centralize a moeda dentro do círculo.' },
  edge: { shape: 'wide', hint: 'Fotografe a moeda de lado.' },
}

/**
 * Uma foto (frente/verso/borda) de um exemplar. Estado próprio e
 * independente por slot — cada quadro busca/faz upload/exclui sua
 * própria imagem sem afetar os outros dois. Nunca mostra "Salvo" antes
 * do upload E da gravação dos metadados terem os dois confirmado
 * sucesso (ver CoinImagesRepository.upload).
 *
 * Seleção de arquivo nunca envia direto — sempre abre o `CoinImageEditor`
 * primeiro (Etapa 9.2); só o canvas já recortado por ele chega a
 * `encodeCroppedCoinImage`/upload.
 */
function CoinImageSlot({
  collectionUnitId,
  kind,
  unitLabel,
  onView,
  onImageChange,
}: {
  collectionUnitId: string
  kind: CoinImageKind
  /** Ex.: "Exemplar #1" — identifica no título do editor qual exemplar está sendo fotografado. */
  unitLabel: string
  /** Abre o CoinImageViewer compartilhado (Etapa 9.3) nesta moeda/exemplar/tipo. */
  onView: () => void
  /**
   * Notifica o pai quando este slot ganha/perde uma foto (Etapa 10) —
   * sem isso, o embed `item.units[].images` usado pela miniatura do
   * card ficaria desatualizado até um novo `list()`. Não altera nada do
   * fluxo de upload/edição em si, só espelha o resultado já confirmado.
   */
  onImageChange?: (image: CoinImage | null) => void
}) {
  const [image, setImage] = useState<CoinImage | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<CoinImageSlotStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [editingFile, setEditingFile] = useState<File | null>(null)
  /** Muda a cada novo arquivo escolhido — força o editor a remontar com estado limpo (zoom/pan/erro). */
  const [editorKey, setEditorKey] = useState(0)
  /** Etapa Lixeira — confirmação de remoção de foto (não é mais window.confirm). */
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false)
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

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setEditorKey((k) => k + 1)
    setEditingFile(file)
  }

  async function handleEditorConfirm(canvas: HTMLCanvasElement) {
    setEditingFile(null)
    setError(null)
    setStatus('processing')

    try {
      const processed = await encodeCroppedCoinImage(canvas, kind)
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
      onImageChange?.(uploaded)
      setTimeout(() => setStatus((current) => (current === 'saved' ? 'idle' : current)), 1500)
    } catch (err) {
      const message =
        err instanceof UnsupportedImageFormatError || err instanceof ImageTooLargeError
          ? err.message
          : 'Não foi possível salvar a foto. Tente novamente.'
      setError(message)
      setStatus('error')
    }
  }

  async function confirmRemove() {
    if (!image) return

    setError(null)
    try {
      await coinImagesRepository.remove(image)
      setImage(null)
      setPreviewUrl(null)
      setStatus('idle')
      onImageChange?.(null)
      setIsRemoveConfirmOpen(false)
    } catch {
      // A remoção do Storage acontece antes da do registro (CoinImagesRepository.remove) —
      // se algo falhar, nada muda visualmente além do erro: a foto continua lá. Fecha o
      // diálogo para o erro ficar visível no slot por trás, mesmo padrão do unitPendingDelete.
      setIsRemoveConfirmOpen(false)
      setError('Não foi possível remover a foto. Tente novamente.')
    }
  }

  const isBusy = status === 'processing' || status === 'uploading'
  const { shape, hint } = COIN_IMAGE_EDITOR_CONFIG[kind]
  const outputSize = OUTPUT_SIZE[kind]
  const aspectStyle = { aspectRatio: `${outputSize.width} / ${outputSize.height}` }
  const EmptyIcon = kind === 'edge' ? Circle : Coins

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-center text-xs font-semibold tracking-wide text-text-secondary uppercase">
        {COIN_IMAGE_KIND_LABELS[kind]}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        className="hidden"
        onChange={handleFileSelected}
      />

      {image && previewUrl ? (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border">
          <div className="relative bg-background" style={aspectStyle}>
            <button
              type="button"
              onClick={onView}
              className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              aria-label={`Ver foto de ${COIN_IMAGE_KIND_LABELS[kind]} ampliada`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL temporária, não é asset estático do Next */}
              <img src={previewUrl} alt={`Foto de ${COIN_IMAGE_KIND_LABELS[kind]}`} className="size-full object-cover" />
            </button>

            {isBusy && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-1.5 border-t border-border bg-surface/60 px-2 py-2">
            <p className="flex items-center justify-center gap-1 text-[11px] font-medium text-success">
              <Check className="size-3" aria-hidden />
              Foto salva
            </p>

            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isBusy}
                className="rounded-md px-2.5 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Substituir
              </button>
              <button
                type="button"
                onClick={() => setIsRemoveConfirmOpen(true)}
                disabled={isBusy}
                className="rounded-md px-2.5 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
          style={aspectStyle}
          className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background p-3 text-text-secondary transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {isBusy ? (
            <Loader2 className="size-6 animate-spin" aria-hidden />
          ) : (
            <EmptyIcon className="size-6 opacity-60" aria-hidden />
          )}
          <span className="text-[11px] text-text-secondary/70">Nenhuma foto adicionada</span>
          <span className="text-xs font-medium text-accent">Adicionar foto</span>
        </button>
      )}

      {status !== 'idle' && status !== 'loading' && status !== 'error' && SLOT_STATUS_LABEL[status] && (
        <p className="text-center text-[11px] text-text-secondary/70">{SLOT_STATUS_LABEL[status]}</p>
      )}
      {error && <p className="text-center text-[11px] text-danger">{error}</p>}

      <CoinImageEditor
        key={editorKey}
        file={editingFile}
        shape={shape}
        outputWidth={outputSize.width}
        outputHeight={outputSize.height}
        title={`${unitLabel} — ${COIN_IMAGE_KIND_LABELS[kind]}`}
        hint={hint}
        onCancel={() => setEditingFile(null)}
        onConfirm={handleEditorConfirm}
      />

      <ConfirmDialog
        isOpen={isRemoveConfirmOpen}
        onClose={() => setIsRemoveConfirmOpen(false)}
        onConfirm={confirmRemove}
        title="Remover esta foto?"
        description={`Esta ação removerá a imagem de ${COIN_IMAGE_KIND_LABELS[kind].toLowerCase()} deste exemplar.`}
        icon={Trash2}
        isDestructive
        confirmLabel="Remover foto"
      />
    </div>
  )
}

export default function CollectionPage() {
  const [items, setItems] = useState<CollectionItem[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [metals, setMetals] = useState<Metal[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isGradeHelpOpen, setIsGradeHelpOpen] = useState(false)

  // Busca, filtros, ordenação, agrupamento e modo de visualização — tudo
  // client-side, sobre os itens já carregados (Etapa 10). Conservação e
  // status são propriedades do EXEMPLAR (collection_units), não da moeda:
  // um item só passa no filtro se existir um MESMO exemplar satisfazendo
  // os dois simultaneamente — nunca combinamos características de
  // exemplares diferentes para "montar" um match artificial.
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterMetal, setFilterMetal] = useState('')
  const [filterGradeId, setFilterGradeId] = useState('')
  const [filterStatus, setFilterStatus] = useState<CollectionUnitStatus | ''>('')
  const [filterYearMin, setFilterYearMin] = useState('')
  const [filterYearMax, setFilterYearMax] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [groupBy, setGroupBy] = useState<GroupOption>('none')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  /**
   * Signed URLs das miniaturas dos cards — só do exemplar PRINCIPAL de
   * cada moeda (Etapa 10), nunca de "qualquer exemplar com foto". Buscadas
   * em lote (`getSignedUrls`) e só para as moedas que passam na
   * busca/filtro atual, nunca para o catálogo inteiro.
   */
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const fetchedThumbPathsRef = useRef(new Set<string>())

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
  const [isDeletingUnit, setIsDeletingUnit] = useState(false)
  /**
   * Erro PRÓPRIO deste ConfirmDialog (Etapa 12.4) — antes, uma falha aqui
   * fechava a confirmação e jogava o erro no `unitsError` do modal por
   * trás; agora, mesmo padrão já usado por "mover para a lixeira"/"excluir
   * permanentemente": o diálogo continua aberto, mostra o erro dentro de
   * si mesmo, e permite nova tentativa manual sem reabrir nada.
   */
  const [unitDeleteError, setUnitDeleteError] = useState<string | null>(null)

  /**
   * Etapa Lixeira — item aguardando confirmação de "mover para a lixeira"
   * (nunca movido direto no clique do ícone 🗑️). `trashSiblingCount` é
   * quantos OUTROS itens compartilham a mesma purchase (buscado do
   * repository ao abrir o diálogo, não do array `items` já carregado).
   */
  const [itemPendingTrash, setItemPendingTrash] = useState<CollectionItem | null>(null)
  const [trashSiblingCount, setTrashSiblingCount] = useState<number | null>(null)
  const [isTrashSiblingCountLoading, setIsTrashSiblingCountLoading] = useState(false)
  const [isMovingToTrash, setIsMovingToTrash] = useState(false)
  const [trashError, setTrashError] = useState<string | null>(null)

  /**
   * CoinImageViewer (Etapa 9.3) — um único viewer compartilhado por todos
   * os exemplares da moeda aberta, não um por slot. `key` força remontar
   * o viewer com estado limpo (zoom/pan/aba) a cada nova abertura, mesmo
   * clicando em outra foto enquanto ele já está aberto.
   */
  const [viewerState, setViewerState] = useState<{ unitId: string; kind: CoinImageKind; key: number } | null>(null)
  /** Exemplares que o viewer aberto no momento pode navegar — do modal de edição OU direto do embed de um card (Etapa 10). */
  const [viewerUnits, setViewerUnits] = useState<CollectionUnit[]>([])

  function openImageViewer(unitsForViewer: CollectionUnit[], unitId: string, kind: CoinImageKind) {
    setViewerUnits(unitsForViewer)
    setViewerState((current) => ({ unitId, kind, key: (current?.key ?? 0) + 1 }))
  }

  /**
   * Modal "Fotos do Exemplar #N" (Etapa 11) — fluxo focado, aberto direto
   * do CTA "+ Adicionar foto" do card, sem passar por "N exemplares".
   * Guarda o item inteiro (não só o id) para poder calcular o índice/
   * rótulo "Exemplar #N" e reabrir o modal completo de exemplares a
   * partir do link "Gerenciar exemplares" sem uma query extra.
   */
  const [photosModalItem, setPhotosModalItem] = useState<CollectionItem | null>(null)
  const [photosModalUnitId, setPhotosModalUnitId] = useState<string | null>(null)

  function openPhotosModal(item: CollectionItem, unit: CollectionItemUnit) {
    setPhotosModalItem(item)
    setPhotosModalUnitId(unit.id)
  }

  function closePhotosModal() {
    setPhotosModalItem(null)
    setPhotosModalUnitId(null)
  }

  /**
   * Modal "Editar Exemplar #N" (Etapa "Editar Exemplar") — fluxo focado,
   * aberto direto do `⋮` no resumo de cada exemplar na Grid. Guarda só os
   * IDs (item + exemplar), NUNCA um snapshot do item: `handleUnitFieldChange`
   * reconstrói o payload de update a partir do objeto `unit` que recebe,
   * então se o modal continuasse lendo de um `CollectionItem` congelado no
   * momento da abertura, a 2ª alteração dentro do mesmo modal enviaria de
   * volta o valor ANTIGO do 1º campo (perdendo a 1ª alteração) — bug real
   * encontrado em teste manual nesta etapa. Resolver o item/exemplar a
   * cada render a partir de `items` (a mesma fonte que `setItems` mantém
   * atualizada em handleUnitFieldChange/handleSetPrimaryUnit/
   * handleUnitDelete/handleUnitImageChange) garante que o modal sempre
   * edita o estado mais recente, igual à Grid por trás dele.
   */
  const [editUnitModalItemId, setEditUnitModalItemId] = useState<string | null>(null)
  const [editUnitModalUnitId, setEditUnitModalUnitId] = useState<string | null>(null)

  function openEditUnitModal(item: CollectionItem, unit: CollectionItemUnit) {
    setEditUnitModalItemId(item.id)
    setEditUnitModalUnitId(unit.id)
  }

  function closeEditUnitModal() {
    setEditUnitModalItemId(null)
    setEditUnitModalUnitId(null)
  }

  /**
   * Feedback "Salvando.../✓ Salvo" por campo (Etapa 12.1) — chaveado por
   * `unitId:campo`, não só pelo campo, para nunca misturar o status de um
   * exemplar com o de outro caso handleUnitFieldChange/handleSetPrimaryUnit
   * sejam chamados por "Gerenciar exemplares" (lista com vários exemplares
   * visíveis ao mesmo tempo) — só o modal "Editar Exemplar" lê este estado,
   * então a escrita extra ali é inofensiva. `saved` limpa sozinho depois de
   * 1750ms; `error` fica até a próxima tentativa no mesmo campo (mesmo
   * padrão já usado por `unitsError`), nunca escondido silenciosamente.
   */
  const [unitFieldSaveStatus, setUnitFieldSaveStatus] = useState<Record<string, UnitFieldSaveStatus>>({})
  const unitFieldSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const timeouts = unitFieldSaveTimeouts.current
    return () => {
      Object.values(timeouts).forEach(clearTimeout)
    }
  }, [])

  function unitFieldStatusKey(unitId: string, field: UnitFieldKey) {
    return `${unitId}:${field}`
  }

  function markUnitFieldStatus(unitId: string, field: UnitFieldKey, status: UnitFieldSaveStatus | null) {
    const key = unitFieldStatusKey(unitId, field)

    const pendingTimeout = unitFieldSaveTimeouts.current[key]
    if (pendingTimeout) {
      clearTimeout(pendingTimeout)
      delete unitFieldSaveTimeouts.current[key]
    }

    setUnitFieldSaveStatus((current) => {
      if (status === null) {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      return { ...current, [key]: status }
    })

    if (status === 'saved') {
      unitFieldSaveTimeouts.current[key] = setTimeout(() => {
        delete unitFieldSaveTimeouts.current[key]
        setUnitFieldSaveStatus((current) => {
          if (!(key in current)) return current
          const next = { ...current }
          delete next[key]
          return next
        })
      }, 1750)
    }
  }

  /**
   * Modal "Informações da moeda" (Etapa 11) — dados da EMISSÃO
   * (collection_item), nunca do exemplar: casa da moeda, quantidade
   * cunhada, história, curiosidades, referências de catálogo. Estado de
   * formulário próprio, inteiramente separado do form de
   * Adicionar/Editar moeda — salva por `updateEnrichment`, que só
   * escreve estes 5 campos (nunca país/ano/metal/quantidade/etc.).
   */
  const [infoModalItem, setInfoModalItem] = useState<CollectionItem | null>(null)
  const [infoMint, setInfoMint] = useState('')
  const [infoMintage, setInfoMintage] = useState('')
  const [infoHistory, setInfoHistory] = useState('')
  const [infoTrivia, setInfoTrivia] = useState('')
  const [infoCatalogRefs, setInfoCatalogRefs] = useState<CatalogReference[]>([])
  const [isInfoSaving, setIsInfoSaving] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)

  function openInfoModal(item: CollectionItem) {
    setInfoError(null)
    setInfoModalItem(item)
    setInfoMint(item.mint ?? '')
    setInfoMintage(item.mintage ?? '')
    setInfoHistory(item.history ?? '')
    setInfoTrivia(item.trivia ?? '')
    setInfoCatalogRefs(item.catalogReferences ?? [])
  }

  function closeInfoModal() {
    setInfoModalItem(null)
  }

  async function handleSaveEnrichment(event: FormEvent) {
    event.preventDefault()
    if (!infoModalItem) return

    // Mintagem é um bigint — nunca passa por Number()/parseInt aqui
    // (perderia precisão acima de Number.MAX_SAFE_INTEGER). Só valida que
    // é uma sequência de dígitos (ou vazio); o próprio Postgres faz o
    // parse real do bigint a partir da string enviada.
    const trimmedMintage = infoMintage.trim()
    if (trimmedMintage !== '' && !/^\d+$/.test(trimmedMintage)) {
      setInfoError('Quantidade cunhada deve ser um número inteiro positivo.')
      return
    }

    setInfoError(null)
    setIsInfoSaving(true)

    const input: CollectionItemEnrichmentInput = {
      mint: toNullableText(infoMint),
      mintage: trimmedMintage === '' ? null : trimmedMintage,
      history: toNullableText(infoHistory),
      trivia: toNullableText(infoTrivia),
      catalogReferences: infoCatalogRefs.length > 0 ? infoCatalogRefs : null,
    }

    try {
      const updated = await collectionRepository.updateEnrichment(infoModalItem.id, input)
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      closeInfoModal()
    } catch (err) {
      setInfoError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsInfoSaving(false)
    }
  }

  function addCatalogReference() {
    setInfoCatalogRefs((current) => [...current, { catalog: '', code: '' }])
  }

  function updateCatalogReference(index: number, changes: Partial<CatalogReference>) {
    setInfoCatalogRefs((current) => current.map((ref, i) => (i === index ? { ...ref, ...changes } : ref)))
  }

  function removeCatalogReference(index: number) {
    setInfoCatalogRefs((current) => current.filter((_, i) => i !== index))
  }

  /**
   * Olho de privacidade do valor de aquisição (Etapa 11) — SÓ estado em
   * memória (React), nunca persistido: recarregar a página sempre volta
   * a ocultar. Não é uma coluna nova, não é preferência salva, não afeta
   * RLS/Passport — só controla o que este componente RENDERIZA a partir
   * de um dado que já pertencia só ao dono (purchase já não é exposto ao
   * Passport nem a outros usuários; isto é só uma tela-de-privacidade
   * visual sobre um dado que já era privado).
   */
  const [visiblePurchaseIds, setVisiblePurchaseIds] = useState<Set<string>>(new Set())

  function togglePurchaseVisibility(itemId: string) {
    setVisiblePurchaseIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  /**
   * Carregamento inicial da tela (Etapa 12.4) — extraído para ser
   * reutilizado tanto pelo `useEffect` de montagem quanto pelo botão
   * "Tentar novamente" do `ErrorState`, sem duplicar a lógica de fetch.
   * `loadError` é um estado PRÓPRIO, separado do `error` genérico (usado
   * por formulários/modais): antes desta etapa os dois compartilhavam a
   * mesma variável, e uma falha aqui virava silenciosamente "Sua coleção
   * ainda está vazia" por trás de uma linha de erro discreta — a auditoria
   * encontrou isso como o problema mais sério do app (ErrorState nunca
   * coexiste com o EmptyState, ver render abaixo).
   */
  // `isLoading`/`loadError` NÃO são resetados aqui de propósito — fazer
  // isso resetaria estado de forma síncrona dentro do efeito de montagem
  // abaixo (react-hooks/set-state-in-effect). No mount, `isLoading` já
  // nasce `true`; no retry, o próprio `ErrorState` já mostra seu spinner
  // interno enquanto esta função está em voo. Encadeamento `.then()` (em
  // vez de async/await) de propósito — o lint acima só reconhece que os
  // `setState` dentro dos callbacks NÃO são síncronos quando eles estão
  // léxicamente dentro de um `.then()`/`.catch()`/`.finally()` separado.
  const loadCollectionData = useCallback(() => {
    return Promise.all([
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
        setLoadError(null)
      })
      .catch((err) => setLoadError(getUserFriendlyErrorMessage(err)))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadCollectionData()
  }, [loadCollectionData])

  const gradesByScale = grades.reduce<Record<string, Grade[]>>((groups, grade) => {
    ;(groups[grade.scale] ??= []).push(grade)
    return groups
  }, {})

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const yearMin = filterYearMin.trim() !== '' ? Number.parseInt(filterYearMin, 10) : null
    const yearMax = filterYearMax.trim() !== '' ? Number.parseInt(filterYearMax, 10) : null

    return items.filter((item) => {
      // País, metal e ano são atributos da MOEDA — sempre avaliados sobre o item.
      if (filterCountry && item.countryCode !== filterCountry) return false
      if (filterMetal && item.metalCode !== filterMetal) return false
      if (yearMin !== null && (item.year === null || item.year < yearMin)) return false
      if (yearMax !== null && (item.year === null || item.year > yearMax)) return false

      // Conservação e status são atributos do EXEMPLAR — a moeda só passa se
      // existir um MESMO exemplar satisfazendo os dois ao mesmo tempo.
      // `is_primary` não participa desta regra (aprovado explicitamente).
      if (filterGradeId || filterStatus) {
        const hasMatchingUnit = item.units.some((unit) => {
          if (filterGradeId && unit.gradeId !== filterGradeId) return false
          if (filterStatus && unit.status !== filterStatus) return false
          return true
        })
        if (!hasMatchingUnit) return false
      }

      if (term === '') return true

      const haystack = [item.denomination, item.countryDisplayName, item.countryCode, item.year?.toString(), item.metalName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(term)
    })
  }, [items, searchTerm, filterCountry, filterMetal, filterGradeId, filterStatus, filterYearMin, filterYearMax])

  const sortedItems = useMemo(() => [...filteredItems].sort(SORTERS[sortBy]), [filteredItems, sortBy])

  const groupedEntries = useMemo<GroupEntry[]>(() => {
    if (groupBy === 'none') {
      return [{ key: GROUP_NONE_KEY, label: '', items: sortedItems }]
    }

    const buckets = new Map<string, GroupEntry>()
    function pushTo(key: string, label: string, item: CollectionItem) {
      const existing = buckets.get(key)
      if (existing) existing.items.push(item)
      else buckets.set(key, { key, label, items: [item] })
    }

    for (const item of sortedItems) {
      if (groupBy === 'country') {
        pushTo(item.countryCode ?? GROUP_NONE_KEY, item.countryDisplayName ?? item.countryCode ?? 'Sem país', item)
      } else if (groupBy === 'metal') {
        pushTo(item.metalCode ?? GROUP_NONE_KEY, item.metalName ?? 'Sem metal', item)
      } else if (groupBy === 'period') {
        if (item.year === null) {
          pushTo(GROUP_NONE_KEY, 'Sem ano', item)
        } else {
          const decade = Math.floor(item.year / 10) * 10
          pushTo(String(decade), `Década de ${decade}`, item)
        }
      } else if (groupBy === 'status') {
        // Um mesmo item pode ter exemplares em status diferentes — ele
        // aparece em CADA grupo de status que algum de seus exemplares
        // tiver. Isto é intencional (aprovado): reflete a realidade dos
        // exemplares, não é duplicação de dado.
        const statuses = new Set(item.units.map((u) => u.status))
        if (statuses.size === 0) {
          pushTo(GROUP_NONE_KEY, 'Sem exemplares', item)
        } else {
          for (const status of statuses) {
            pushTo(status, `${COLLECTION_UNIT_STATUS_EMOJI[status]} ${COLLECTION_UNIT_STATUS_LABELS[status]}`, item)
          }
        }
      }
    }

    return Array.from(buckets.values()).sort((a, b) => {
      if (groupBy === 'status') {
        const indexA = COLLECTION_UNIT_STATUS_OPTIONS.indexOf(a.key as CollectionUnitStatus)
        const indexB = COLLECTION_UNIT_STATUS_OPTIONS.indexOf(b.key as CollectionUnitStatus)
        if (indexA !== -1 && indexB !== -1) return indexA - indexB
      }
      if (a.key === GROUP_NONE_KEY) return 1
      if (b.key === GROUP_NONE_KEY) return -1
      return a.label.localeCompare(b.label, 'pt-BR')
    })
  }, [sortedItems, groupBy])

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)
  // Mesmo cálculo do resumo público do Passport (get_public_passport) — países/metais distintos entre TODAS as moedas, não só as filtradas.
  const countryCount = new Set(items.map((item) => item.countryCode).filter((code): code is string => code !== null)).size
  const metalCount = new Set(items.map((item) => item.metalCode).filter((code): code is string => code !== null)).size

  /**
   * Etapa 11: agora busca as até 3 fotos (frente/verso/borda) do exemplar
   * PRINCIPAL — não só a de frente — para o card poder alternar entre
   * elas sem nova request. Continua sendo UMA chamada em lote
   * (`getSignedUrls`) por leva de paths novos, só mais paths na mesma
   * chamada — nenhum N+1 novo.
   */
  const neededThumbPaths = useMemo(() => {
    const paths: string[] = []
    for (const item of filteredItems) {
      const primaryUnit = getPrimaryUnit(item)
      if (!primaryUnit) continue
      for (const image of primaryUnit.images) {
        paths.push(image.storagePath)
      }
    }
    return paths
  }, [filteredItems])

  // Miniaturas em lote (Etapa 10): só para as moedas que passam na
  // busca/filtro atual (`neededThumbPaths` deriva de `filteredItems`, não
  // de `items`), uma única chamada `getSignedUrls` por leva de paths
  // novos — nunca uma signed URL por card, nunca regerada para um path já
  // conhecido. Mesmo padrão `{cancelled, settled}` do CoinImageViewer
  // (Etapa 9.3) para sobreviver ao double-invoke do StrictMode em dev sem
  // perder o resultado de um fetch que já estava em voo.
  useEffect(() => {
    const fetchedPaths = fetchedThumbPathsRef.current
    const missing = neededThumbPaths.filter((path) => !fetchedPaths.has(path))
    if (missing.length === 0) return
    missing.forEach((path) => fetchedPaths.add(path))

    const state = { cancelled: false, settled: false }
    coinImagesRepository
      .getSignedUrls(missing)
      .then((urls) => {
        state.settled = true
        if (!state.cancelled) setThumbUrls((current) => ({ ...current, ...urls }))
      })
      .catch(() => {
        state.settled = true
        missing.forEach((path) => fetchedPaths.delete(path))
      })

    return () => {
      state.cancelled = true
      if (!state.settled) missing.forEach((path) => fetchedPaths.delete(path))
    }
  }, [neededThumbPaths])

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
    // Etapa 15.4 — decisão explícita: PREFILL NÃO ALTERADO. Este
    // formulário edita a compra LEGADA/original do item
    // (`item.purchase`/`item.purchaseId`, via `purchasesRepository.
    // update()` em collection.repository.ts) — nunca as compras
    // adicionais que só existem em collection_units. Preencher aqui com
    // qualquer outra coisa que não `item.purchase` faria o Salvar
    // sobrescrever a compra errada. Migrar este formulário para múltiplas
    // compras por exemplar é um redesenho de escrita fora do escopo desta
    // etapa (só leituras foram migradas).
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
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Abre o ConfirmDialog de "mover para a lixeira" (Etapa Lixeira) — nunca
   * mais um DELETE direto a partir da coleção ativa. Busca a contagem de
   * OUTROS itens que compartilham QUALQUER UMA das compras deste item via
   * repository (não do array `items` já carregado, que só tem itens
   * ativos e não refletiria compras compartilhadas com itens já na
   * lixeira).
   *
   * Etapa 15.4: `item.purchaseId` (legado, só a 1ª compra do item) trocado
   * por `getItemPurchaseIds(item)` — todas as compras distintas presentes
   * nos exemplares reais do item. Corrige um falso negativo real: uma
   * compra que financiou exemplares deste item mas não é a primeira dele
   * (ex.: item aumentado de quantidade mais de uma vez) antes ficava
   * invisível para esta checagem.
   */
  async function handleDelete(item: CollectionItem) {
    setTrashError(null)
    setItemPendingTrash(item)
    setTrashSiblingCount(null)

    const purchaseIds = getItemPurchaseIds(item)

    if (purchaseIds.length > 0) {
      setIsTrashSiblingCountLoading(true)
      try {
        const count = await collectionRepository.countOtherItemsForPurchases(purchaseIds, item.id)
        setTrashSiblingCount(count)
      } catch {
        // informação secundária do diálogo — não impede a ação principal
        setTrashSiblingCount(0)
      } finally {
        setIsTrashSiblingCountLoading(false)
      }
    }
  }

  function closeTrashConfirm() {
    setItemPendingTrash(null)
    setTrashSiblingCount(null)
    setTrashError(null)
  }

  /**
   * A ação real: só `deleted_at = now()` em collection_items. Nenhum
   * collection_unit, coin_image, arquivo do Storage ou purchase é tocado
   * — por isso não há limpeza de Storage aqui, ao contrário do antigo
   * `handleDelete`/`remove()` (que agora só roda a partir da Lixeira).
   */
  async function confirmMoveToTrash() {
    const item = itemPendingTrash
    if (!item) return

    setIsMovingToTrash(true)
    setTrashError(null)

    try {
      await collectionRepository.softDelete(item.id)
      setItems((current) => current.filter((i) => i.id !== item.id))
      closeTrashConfirm()
    } catch (err) {
      setTrashError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsMovingToTrash(false)
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
      setUnitsError(getUserFriendlyErrorMessage(err))
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
    // Cada chamador desta função só muda 1 campo por vez (ver os 3 call
    // sites em "Gerenciar exemplares" e em "Editar Exemplar") — por isso é
    // seguro derivar qual campo rastrear a partir da 1ª chave de `changes`.
    const field = Object.keys(changes)[0] as UnitFieldKey | undefined
    if (field) markUnitFieldStatus(unit.id, field, 'saving')

    try {
      const updated = await collectionUnitsRepository.update(unit.id, {
        gradeId: changes.gradeId !== undefined ? changes.gradeId : unit.gradeId,
        status: changes.status ?? unit.status,
        rating: changes.rating !== undefined ? changes.rating : unit.rating,
      })
      setUnits((current) => current.map((u) => (u.id === updated.id ? updated : u)))
      // Mesmo motivo do handleUnitImageChange (Etapa 10): sem isto, o embed
      // `items[].units` usado por filtros/Grid/Lista ficaria com
      // conservação/status/rating desatualizados até um novo `list()`.
      // `{ ...u, ...updated }` preserva `images` (que só existe no embed,
      // não em `CollectionUnit`) e sobrescreve o resto com o valor confirmado.
      setItems((current) =>
        current.map((item) =>
          item.units.some((u) => u.id === updated.id)
            ? { ...item, units: item.units.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)) }
            : item,
        ),
      )
      if (field) markUnitFieldStatus(unit.id, field, 'saved')
    } catch (err) {
      setUnitsError(getUserFriendlyErrorMessage(err))
      if (field) markUnitFieldStatus(unit.id, field, 'error')
    }
  }

  /**
   * Mantém `items[].units[].images` em dia quando uma foto é
   * adicionada/removida num `CoinImageSlot` (Etapa 10) — é esse embed
   * que a miniatura do card em Grid/Lista usa; sem isto, ela só
   * atualizaria depois de um novo `list()` (reload).
   */
  function handleUnitImageChange(unitId: string, kind: CoinImageKind, image: CoinImage | null) {
    setItems((current) =>
      current.map((item) => {
        if (!item.units.some((u) => u.id === unitId)) return item
        return {
          ...item,
          units: item.units.map((u) => {
            if (u.id !== unitId) return u
            const otherImages = u.images.filter((existing) => existing.kind !== kind)
            return {
              ...u,
              images: image ? [...otherImages, { kind: image.kind, storagePath: image.storagePath }] : otherImages,
            }
          }),
        }
      }),
    )
  }

  /**
   * Troca o exemplar principal via RPC atômica (`set_primary_collection_unit`
   * — Etapa 10): nunca 0 nem 2 principais simultâneos, garantido pelo
   * banco. Atualiza os dois estados locais (`units` do modal e o embed
   * `items[].units` usado pela Grid/Lista) para refletir a mudança na
   * hora, sem esperar um novo `list()`.
   */
  async function handleSetPrimaryUnit(unit: CollectionUnit) {
    setUnitsError(null)
    markUnitFieldStatus(unit.id, 'isPrimary', 'saving')

    try {
      await collectionUnitsRepository.setPrimary(unit.id)
      setUnits((current) => current.map((u) => ({ ...u, isPrimary: u.id === unit.id })))
      setItems((current) =>
        current.map((item) =>
          item.id === unit.collectionItemId
            ? { ...item, units: item.units.map((u) => ({ ...u, isPrimary: u.id === unit.id })) }
            : item,
        ),
      )
      markUnitFieldStatus(unit.id, 'isPrimary', 'saved')
    } catch (err) {
      setUnitsError(getUserFriendlyErrorMessage(err))
      markUnitFieldStatus(unit.id, 'isPrimary', 'error')
    }
  }

  /** Abre a confirmação — a exclusão em si só acontece em `confirmUnitDelete`. */
  function handleUnitDelete(unit: CollectionUnit) {
    setUnitDeleteError(null)
    setUnitPendingDelete(unit)
  }

  function closeUnitDeleteConfirm() {
    setUnitPendingDelete(null)
    setUnitDeleteError(null)
  }

  /**
   * Espelha localmente a mesma regra do trigger `promote_primary_after_unit_delete`
   * (o mais antigo entre os restantes vira principal) para a UI refletir a
   * troca sem precisar recarregar — o banco é quem garante isso de
   * verdade; isto só evita uma query extra no caminho comum.
   */
  function withPrimaryReassignedAfterRemoval<T extends CollectionUnit>(remaining: T[], removedWasPrimary: boolean): T[] {
    if (!removedWasPrimary || remaining.length === 0 || remaining.some((u) => u.isPrimary)) return remaining
    // `id` como desempate — mesmo motivo do trigger no banco: exemplares
    // criados em lote têm createdAt idêntico entre si.
    const oldest = [...remaining].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )[0]
    return remaining.map((u) => (u.id === oldest.id ? { ...u, isPrimary: true } : u))
  }

  async function confirmUnitDelete() {
    const unit = unitPendingDelete
    if (!unit) return

    setIsDeletingUnit(true)
    setUnitDeleteError(null)

    try {
      await collectionUnitsRepository.remove(unit.id)
      setUnits((current) => withPrimaryReassignedAfterRemoval(current.filter((u) => u.id !== unit.id), unit.isPrimary))
      setItems((current) =>
        current.map((item) =>
          item.id === unit.collectionItemId
            ? {
                ...item,
                quantity: item.quantity - 1,
                units: withPrimaryReassignedAfterRemoval(
                  item.units.filter((u) => u.id !== unit.id),
                  unit.isPrimary,
                ),
              }
            : item,
        ),
      )
      setUnitsModalItem((current) => (current ? { ...current, quantity: current.quantity - 1 } : current))
      // Se o exemplar excluído era o que estava aberto em "Editar Exemplar",
      // não sobra nada para esse modal mostrar — fecha em vez de deixá-lo
      // "pendurado" apontando para um exemplar que não existe mais.
      if (editUnitModalUnitId === unit.id) closeEditUnitModal()
      setUnitPendingDelete(null)
    } catch (err) {
      // Etapa 12.4: o diálogo agora PERMANECE aberto em caso de erro (antes
      // fechava e jogava o erro no modal por trás) — inclui a mensagem
      // amigável de "último exemplar" vinda do banco (P0001), que passa
      // por getUserFriendlyErrorMessage inalterada (não tem o prefixo
      // interno `[XRepository]`).
      setUnitDeleteError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsDeletingUnit(false)
    }
  }

  const hasActiveFilters =
    searchTerm !== '' ||
    filterCountry !== '' ||
    filterMetal !== '' ||
    filterGradeId !== '' ||
    filterStatus !== '' ||
    filterYearMin !== '' ||
    filterYearMax !== ''

  function clearFilters() {
    setSearchTerm('')
    setFilterCountry('')
    setFilterMetal('')
    setFilterGradeId('')
    setFilterStatus('')
    setFilterYearMin('')
    setFilterYearMax('')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Minha Coleção"
        description="Organize e acompanhe suas moedas."
        actions={
          <>
            <Link
              href="/dashboard/collection/trash"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface-hover px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Trash2 className="size-4" aria-hidden />
              Lixeira
            </Link>
            <Button type="button" onClick={openAddModal}>
              <Plus className="size-4" aria-hidden />
              Adicionar moeda
            </Button>
          </>
        }
      />

      {error && <p className="text-sm text-danger">{error}</p>}
      {successMessage && <p className="text-sm text-success">{successMessage}</p>}

      {items.length > 0 && (
        <>
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{items.length}</span> moeda{items.length === 1 ? '' : 's'}{' '}
            <span className="text-text-secondary/50">·</span> <span className="font-medium text-text-primary">{totalUnits}</span>{' '}
            exemplar{totalUnits === 1 ? '' : 'es'} <span className="text-text-secondary/50">·</span>{' '}
            <span className="font-medium text-text-primary">{countryCount}</span> país{countryCount === 1 ? '' : 'es'}{' '}
            <span className="text-text-secondary/50">·</span> <span className="font-medium text-text-primary">{metalCount}</span>{' '}
            {metalCount === 1 ? 'metal' : 'metais'}
          </p>

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden
            />
            <Input
              placeholder="Buscar por denominação, país, ano, metal..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)} aria-label="Filtrar por país">
              <option value="">País</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.flagEmoji ? `${country.flagEmoji} ` : ''}
                  {country.name}
                </option>
              ))}
            </Select>
            <Select value={filterMetal} onChange={(e) => setFilterMetal(e.target.value)} aria-label="Filtrar por metal">
              <option value="">Metal</option>
              {metals.map((metal) => (
                <option key={metal.code} value={metal.code}>
                  {metal.name}
                </option>
              ))}
            </Select>
            <Select value={filterGradeId} onChange={(e) => setFilterGradeId(e.target.value)} aria-label="Filtrar por conservação">
              <option value="">Conservação</option>
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
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as CollectionUnitStatus | '')}
              aria-label="Filtrar por status do exemplar"
            >
              <option value="">Status</option>
              {COLLECTION_UNIT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {COLLECTION_UNIT_STATUS_EMOJI[status]} {COLLECTION_UNIT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Ano de"
                aria-label="Ano mínimo"
                value={filterYearMin}
                onChange={(e) => setFilterYearMin(e.target.value)}
              />
              <span className="shrink-0 text-text-secondary/50">–</span>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Ano até"
                aria-label="Ano máximo"
                value={filterYearMax}
                onChange={(e) => setFilterYearMax(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="size-4 shrink-0 text-text-secondary" aria-hidden />
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} aria-label="Ordenar por">
                {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <FolderTree className="size-4 shrink-0 text-text-secondary" aria-hidden />
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupOption)} aria-label="Agrupar por">
                {(Object.keys(GROUP_LABELS) as GroupOption[]).map((option) => (
                  <option key={option} value={option}>
                    {GROUP_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                aria-label="Visualização em grade"
                className={cn(
                  'flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                  viewMode === 'grid' ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <LayoutGrid className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                aria-label="Visualização em lista"
                className={cn(
                  'flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                  viewMode === 'list' ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <List className="size-4" aria-hidden />
              </button>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                <X className="size-3.5" aria-hidden />
                Limpar filtros
              </button>
            )}
          </div>
        </>
      )}

      {isLoading ? (
        <p className="text-sm text-text-secondary">Carregando...</p>
      ) : loadError ? (
        <ErrorState
          title="Não foi possível carregar sua coleção"
          description={loadError}
          actionLabel="Tentar novamente"
          onAction={loadCollectionData}
        />
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
          description={hasActiveFilters ? 'Experimente remover alguns filtros.' : undefined}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groupedEntries.map((group) => (
            <div key={group.key} className="flex flex-col gap-3">
              {groupBy !== 'none' && (
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  {group.label}
                  <span className="font-normal text-text-secondary">
                    ({group.items.length} moeda{group.items.length === 1 ? '' : 's'})
                  </span>
                </h2>
              )}

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((item) => (
                    <Card key={`${group.key}:${item.id}`} hoverable className="flex flex-col overflow-hidden">
                      <div className="relative aspect-[4/3] bg-gradient-to-br from-surface-hover to-surface">
                        <CollectionItemThumbnail
                          item={item}
                          thumbUrls={thumbUrls}
                          onOpenViewer={openImageViewer}
                          onAddPhoto={openPhotosModal}
                        />
                      </div>

                      <div className="flex flex-1 flex-col gap-3.5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-text-primary">{item.denomination ?? 'Sem denominação'}</p>
                            <p className="mt-0.5 text-sm text-text-secondary">
                              {item.countryFlagEmoji ? `${item.countryFlagEmoji} ` : ''}
                              {item.countryDisplayName ?? item.countryCode ?? '—'} · {item.year ?? '—'}
                            </p>
                          </div>
                          <IconButton icon={Info} onClick={() => openInfoModal(item)} aria-label="Informações da moeda" />
                        </div>

                        {item.metalName && (
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone="accent">
                              {item.secondaryMetalName ? `${item.metalName} + ${item.secondaryMetalName}` : item.metalName}
                            </Badge>
                          </div>
                        )}

                        {item.units.length > 0 && (
                          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                            <button
                              type="button"
                              onClick={() => openUnitsModal(item)}
                              className="flex shrink-0 items-center gap-1 self-start rounded text-xs font-medium text-accent transition-colors hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            >
                              <Layers className="size-3.5" aria-hidden />
                              {item.units.length} exemplar{item.units.length === 1 ? '' : 'es'}
                            </button>
                            <GridUnitSummary
                              units={item.units}
                              onEditUnit={(unit) => openEditUnitModal(item, unit)}
                            />
                          </div>
                        )}

                        <div className="mt-auto flex items-center justify-between border-t border-border pt-3.5">
                          <PurchaseValue
                            item={item}
                            visible={visiblePurchaseIds.has(item.id)}
                            onToggle={() => togglePurchaseVisibility(item.id)}
                          />
                          <div className="flex gap-1">
                            <IconButton icon={Pencil} onClick={() => openEditModal(item)} aria-label="Editar moeda" />
                            <IconButton
                              icon={Trash2}
                              variant="danger"
                              onClick={() => handleDelete(item)}
                              aria-label="Mover moeda para a lixeira"
                              title="Mover para a lixeira"
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {group.items.map((item) => (
                    <Card key={`${group.key}:${item.id}`} hoverable className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-surface-hover to-surface">
                        <CollectionItemThumbnail
                          item={item}
                          thumbUrls={thumbUrls}
                          onOpenViewer={openImageViewer}
                          onAddPhoto={openPhotosModal}
                          compact
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-text-primary">{item.denomination ?? 'Sem denominação'}</p>
                        <p className="truncate text-sm text-text-secondary">
                          {item.countryFlagEmoji ? `${item.countryFlagEmoji} ` : ''}
                          {item.countryDisplayName ?? item.countryCode ?? '—'} · {item.year ?? '—'}
                          {item.metalName ? ` · ${item.metalName}` : ''}
                        </p>
                      </div>

                      <ListStatusCounts units={item.units} />

                      <button
                        type="button"
                        onClick={() => openUnitsModal(item)}
                        className="flex shrink-0 items-center gap-1 rounded text-xs font-medium text-accent transition-colors hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        <Layers className="size-3.5" aria-hidden />
                        {item.units.length} exemplar{item.units.length === 1 ? '' : 'es'}
                      </button>

                      <PurchaseValue
                        item={item}
                        visible={visiblePurchaseIds.has(item.id)}
                        onToggle={() => togglePurchaseVisibility(item.id)}
                        align="right"
                      />

                      <div className="flex shrink-0 gap-1">
                        <IconButton icon={Info} onClick={() => openInfoModal(item)} aria-label="Informações da moeda" />
                        <IconButton icon={Pencil} onClick={() => openEditModal(item)} aria-label="Editar moeda" />
                        <IconButton
                          icon={Trash2}
                          variant="danger"
                          onClick={() => handleDelete(item)}
                          aria-label="Mover moeda para a lixeira"
                          title="Mover para a lixeira"
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
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
            <SectionHeading icon={Landmark}>Dados da moeda</SectionHeading>

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
                    <IconButton
                      icon={HelpCircle}
                      size="sm"
                      onClick={() => setIsGradeHelpOpen(true)}
                      aria-label="Ajuda sobre níveis de conservação"
                    />
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
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                    Exemplar #{index + 1}
                    <span className="font-mono text-xs font-normal text-text-secondary/50">{unit.id.slice(0, 8)}</span>
                    {unit.isPrimary && (
                      <Badge tone="accent" className="gap-1">
                        <Bookmark className="size-3 fill-accent text-accent" aria-hidden />
                        Principal
                      </Badge>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {!unit.isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleSetPrimaryUnit(unit)}
                        className="rounded-lg px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        Definir como principal
                      </button>
                    )}
                    <IconButton
                      icon={Trash2}
                      variant="danger"
                      onClick={() => handleUnitDelete(unit)}
                      aria-label="Excluir exemplar"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Imagens do exemplar</span>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2.5">
                    {COIN_IMAGE_KINDS.map((kind) => (
                      <CoinImageSlot
                        key={kind}
                        collectionUnitId={unit.id}
                        kind={kind}
                        unitLabel={`Exemplar #${index + 1}`}
                        onView={() => openImageViewer(units, unit.id, kind)}
                        onImageChange={(image) => handleUnitImageChange(unit.id, kind, image)}
                      />
                    ))}
                  </div>
                </div>

                <FieldRow>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-sm font-medium text-text-secondary">Conservação</label>
                      <IconButton
                        icon={HelpCircle}
                        size="sm"
                        onClick={() => setIsGradeHelpOpen(true)}
                        aria-label="Ajuda sobre níveis de conservação"
                      />
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
                        {COLLECTION_UNIT_STATUS_EMOJI[status]} {COLLECTION_UNIT_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                </FieldRow>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-text-secondary">Minha avaliação</span>
                  <p className="text-xs font-medium text-accent">
                    Minha avaliação — não representa a conservação.
                  </p>
                  <StarRatingInput
                    value={unit.rating}
                    onChange={(rating) => handleUnitFieldChange(unit, { rating })}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={unitPendingDelete !== null}
        onClose={closeUnitDeleteConfirm}
        onConfirm={confirmUnitDelete}
        title="Excluir este exemplar?"
        description="Esta ação removerá apenas este exemplar da coleção — a moeda e os demais exemplares não são afetados."
        icon={Trash2}
        isDestructive
        confirmLabel="Excluir exemplar"
        isLoading={isDeletingUnit}
        error={unitDeleteError}
      />

      {/*
        Etapa Lixeira — "mover para a lixeira" substitui o antigo
        window.confirm de exclusão de moeda. Reversível (não usa
        isDestructive): só collection_items.deleted_at muda, nada é
        apagado. `trashSiblingCount` vem do repository (não do array
        `items`, que só tem itens ativos), então a informação de "compra
        em lote" continua correta mesmo se outra moeda da mesma compra já
        estiver na lixeira.
      */}
      <ConfirmDialog
        isOpen={itemPendingTrash !== null}
        onClose={closeTrashConfirm}
        onConfirm={confirmMoveToTrash}
        title="Mover moeda para a lixeira?"
        description="Esta moeda será removida da sua coleção ativa, mas poderá ser restaurada posteriormente."
        icon={Trash2}
        confirmLabel="Mover para a lixeira"
        isLoading={isMovingToTrash}
        error={trashError}
      >
        {itemPendingTrash && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
            <p className="font-medium text-text-primary">{itemPendingTrash.denomination ?? 'Sem denominação'}</p>
            <p className="text-text-secondary">
              {itemPendingTrash.countryFlagEmoji ? `${itemPendingTrash.countryFlagEmoji} ` : ''}
              {itemPendingTrash.countryDisplayName ?? itemPendingTrash.countryCode ?? '—'}
              {itemPendingTrash.year !== null ? ` · ${itemPendingTrash.year}` : ''}
            </p>
            <p className="text-text-secondary">
              {itemPendingTrash.units.length} exemplar{itemPendingTrash.units.length === 1 ? '' : 'es'}
            </p>
            {(() => {
              // Etapa 15.4: substitui `itemPendingTrash.purchase.totalPrice`
              // (legado, só a 1ª compra) por getItemAcquisitionSummary —
              // mesma regra de "Preço de aquisição" usada no card, mas em
              // texto simples (o ConfirmDialog não precisa do "custo
              // médio" — só confirmar o valor antes de uma ação).
              const summary = getItemAcquisitionSummary(itemPendingTrash)
              const hasValue = !(summary.isUniform && summary.uniformCost === null)
              if (!hasValue) return null
              return (
                <p className="text-text-secondary">
                  Valor de aquisição:{' '}
                  {summary.isUniform
                    ? `R$ ${summary.uniformCost!.toFixed(2)}`
                    : `R$ ${summary.totalInvested.toFixed(2)} (${summary.activeUnitCount} exemplares)`}
                </p>
              )
            })()}
            {getItemPurchaseIds(itemPendingTrash).length > 0 &&
              (isTrashSiblingCountLoading ? (
                <p className="text-xs text-text-secondary/70">Verificando compra vinculada...</p>
              ) : (
                trashSiblingCount !== null && (
                  <p className="text-xs font-medium text-accent">
                    {trashSiblingCount === 0
                      ? 'Esta é a única moeda vinculada a esta compra.'
                      : `Esta moeda faz parte de uma compra com outras ${trashSiblingCount} moeda${trashSiblingCount === 1 ? '' : 's'}. Somente esta moeda será movida para a lixeira.`}
                  </p>
                )
              ))}
          </div>
        )}
      </ConfirmDialog>

      <CoinImageViewer
        key={viewerState?.key}
        isOpen={viewerState !== null}
        units={viewerUnits}
        initialUnitId={viewerState?.unitId ?? ''}
        initialKind={viewerState?.kind ?? 'front'}
        onClose={() => setViewerState(null)}
      />

      {/*
        Etapa 11 — fluxo focado de fotos, aberto direto do CTA "+ Adicionar
        foto" do card. Reaproveita CoinImageSlot tal como é usado no modal
        completo de exemplares — mesmo componente, mesma lógica de
        upload/editor, só um container mais enxuto (sem grade/status/
        avaliação/excluir). "Gerenciar exemplares" é a saída para quem
        precisa de mais do que só fotos.
      */}
      {(() => {
        const photosUnit = photosModalItem?.units.find((u) => u.id === photosModalUnitId) ?? null
        const photosUnitIndex = photosModalItem && photosUnit ? photosModalItem.units.indexOf(photosUnit) : -1

        return (
          <Modal
            isOpen={photosModalItem !== null && photosUnit !== null}
            onClose={closePhotosModal}
            title={photosUnitIndex !== -1 ? `Fotos do Exemplar #${photosUnitIndex + 1}` : 'Fotos do exemplar'}
            description={photosModalItem?.denomination ?? undefined}
          >
            {photosModalItem && photosUnit && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2.5">
                  {COIN_IMAGE_KINDS.map((kind) => (
                    <CoinImageSlot
                      key={kind}
                      collectionUnitId={photosUnit.id}
                      kind={kind}
                      unitLabel={`Exemplar #${photosUnitIndex + 1}`}
                      onView={() => openImageViewer(photosModalItem.units, photosUnit.id, kind)}
                      onImageChange={(image) => handleUnitImageChange(photosUnit.id, kind, image)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const item = photosModalItem
                    closePhotosModal()
                    openUnitsModal(item)
                  }}
                  className="self-start text-xs font-medium text-text-secondary underline decoration-dotted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
                >
                  Gerenciar exemplares
                </button>
              </div>
            )}
          </Modal>
        )
      })()}

      {/*
        Etapa "Editar Exemplar" — fluxo focado aberto pelo ⋮ no resumo de
        cada exemplar na Grid (GridUnitSummary). Reaproveita os MESMOS
        handlers já usados por "Gerenciar exemplares"
        (handleUnitFieldChange/handleSetPrimaryUnit/handleUnitDelete/
        handleUnitImageChange) — nenhuma lógica de escrita nova, só uma UI
        focada em cima de escritas que já existiam. Trabalha
        exclusivamente com o `collection_unit` selecionado; nunca escreve
        em collection_items. "Gerenciar exemplares" continua existindo
        sem alteração, para quem quer ver todos os exemplares de uma vez.
      */}
      {(() => {
        const editUnitModalItem = items.find((i) => i.id === editUnitModalItemId) ?? null
        const editUnit = editUnitModalItem?.units.find((u) => u.id === editUnitModalUnitId) ?? null
        const editUnitIndex = editUnitModalItem && editUnit ? editUnitModalItem.units.indexOf(editUnit) : -1

        return (
          <Modal
            isOpen={editUnitModalItem !== null && editUnit !== null}
            onClose={closeEditUnitModal}
            title={editUnitIndex !== -1 ? `Editar Exemplar #${editUnitIndex + 1}` : 'Editar exemplar'}
            description="Gerencie fotos, conservação, avaliação e disponibilidade deste exemplar."
          >
            {editUnitModalItem && editUnit && (
              <div className="flex flex-col gap-5">
                {unitsError && <p className="text-sm text-danger">{unitsError}</p>}

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Fotos</span>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2.5">
                    {COIN_IMAGE_KINDS.map((kind) => (
                      <CoinImageSlot
                        key={kind}
                        collectionUnitId={editUnit.id}
                        kind={kind}
                        unitLabel={`Exemplar #${editUnitIndex + 1}`}
                        onView={() => openImageViewer(editUnitModalItem.units, editUnit.id, kind)}
                        onImageChange={(image) => handleUnitImageChange(editUnit.id, kind, image)}
                      />
                    ))}
                  </div>
                </div>

                <FieldRow>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-sm font-medium text-text-secondary">Conservação</label>
                      <IconButton
                        icon={HelpCircle}
                        size="sm"
                        onClick={() => setIsGradeHelpOpen(true)}
                        aria-label="Ajuda sobre níveis de conservação"
                      />
                    </div>
                    <Select
                      value={editUnit.gradeId ?? ''}
                      onChange={(e) => handleUnitFieldChange(editUnit, { gradeId: toNullableText(e.target.value) })}
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
                    <UnitFieldSaveIndicator status={unitFieldSaveStatus[unitFieldStatusKey(editUnit.id, 'gradeId')]} />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Select
                      label="Status"
                      value={editUnit.status}
                      onChange={(e) =>
                        handleUnitFieldChange(editUnit, { status: e.target.value as CollectionUnitStatus })
                      }
                    >
                      {COLLECTION_UNIT_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {COLLECTION_UNIT_STATUS_EMOJI[status]} {COLLECTION_UNIT_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                    <UnitFieldSaveIndicator status={unitFieldSaveStatus[unitFieldStatusKey(editUnit.id, 'status')]} />
                  </div>
                </FieldRow>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-text-secondary">Minha avaliação</span>
                  <p className="text-xs font-medium text-accent">
                    Minha avaliação — não representa a conservação.
                  </p>
                  <StarRatingInput
                    value={editUnit.rating}
                    onChange={(rating) => handleUnitFieldChange(editUnit, { rating })}
                  />
                  <UnitFieldSaveIndicator status={unitFieldSaveStatus[unitFieldStatusKey(editUnit.id, 'rating')]} />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                    <Bookmark
                      className={editUnit.isPrimary ? 'size-4 shrink-0 fill-accent text-accent' : 'size-4 shrink-0'}
                      aria-hidden
                    />
                    {editUnit.isPrimary ? 'Este é o exemplar principal.' : 'Não é o exemplar principal.'}
                  </span>
                  <div className="flex items-center gap-2">
                    <UnitFieldSaveIndicator status={unitFieldSaveStatus[unitFieldStatusKey(editUnit.id, 'isPrimary')]} />
                    {!editUnit.isPrimary && (
                      <Button type="button" variant="secondary" size="sm" onClick={() => handleSetPrimaryUnit(editUnit)}>
                        Definir como principal
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex justify-end border-t border-border pt-4">
                  <Button type="button" variant="danger" size="sm" onClick={() => handleUnitDelete(editUnit)}>
                    <Trash2 className="size-4" aria-hidden />
                    Excluir exemplar
                  </Button>
                </div>
              </div>
            )}
          </Modal>
        )
      })()}

      {/*
        Etapa 11 — "Informações da moeda": dados da EMISSÃO
        (collection_item), nunca do exemplar — visualmente separado da
        edição de exemplar/moeda. Salva por `updateEnrichment`, que só
        escreve estes 5 campos.
      */}
      <Modal
        isOpen={infoModalItem !== null}
        onClose={closeInfoModal}
        title="Informações da moeda"
        description={infoModalItem?.denomination ?? undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeInfoModal} disabled={isInfoSaving}>
              Cancelar
            </Button>
            <Button type="submit" form="coin-info-form" isLoading={isInfoSaving}>
              {isInfoSaving ? 'Salvando...' : 'Salvar'}
            </Button>
          </>
        }
      >
        <form id="coin-info-form" onSubmit={handleSaveEnrichment} className="flex flex-col gap-7">
          {infoError && <p className="text-sm text-danger">{infoError}</p>}

          <div className="flex flex-col gap-4">
            <SectionHeading icon={Landmark}>Dados históricos</SectionHeading>

            <Input
              label="Casa da moeda"
              value={infoMint}
              onChange={(e) => setInfoMint(e.target.value)}
              placeholder="Ex.: Casa da Moeda do Brasil"
            />

            <div className="flex flex-col gap-1.5">
              <Input
                label="Quantidade cunhada"
                inputMode="numeric"
                value={infoMintage}
                onChange={(e) => setInfoMintage(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Ex.: 5000000"
              />
              <p className="text-xs text-text-secondary/70">
                Quantas peças foram cunhadas historicamente — diferente de quantos exemplares você possui.
              </p>
            </div>

            {/*
              História/curiosidades: texto livre por enquanto (Etapa 11).
              "Gerar com IA" (fora de escopo agora) entraria aqui como uma
              ação adicional ao lado do rótulo de cada campo — a estrutura
              já separa história de curiosidades em campos próprios
              exatamente para isso não exigir redesenhar o modal depois.
            */}
            <Textarea
              label="História da emissão"
              value={infoHistory}
              onChange={(e) => setInfoHistory(e.target.value)}
              rows={4}
              placeholder="Contexto histórico desta emissão..."
            />

            <Textarea
              label="Curiosidades"
              value={infoTrivia}
              onChange={(e) => setInfoTrivia(e.target.value)}
              rows={3}
              placeholder="Fatos interessantes sobre esta moeda..."
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <SectionHeading icon={ClipboardList}>Catalogação</SectionHeading>

            {infoCatalogRefs.length > 0 && (
              <div className="flex flex-col gap-3">
                {infoCatalogRefs.map((ref, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <Input
                      label={index === 0 ? 'Catálogo' : undefined}
                      value={ref.catalog}
                      onChange={(e) => updateCatalogReference(index, { catalog: e.target.value })}
                      placeholder="Ex.: KM"
                      className="flex-1"
                    />
                    <Input
                      label={index === 0 ? 'Código' : undefined}
                      value={ref.code}
                      onChange={(e) => updateCatalogReference(index, { code: e.target.value })}
                      placeholder="Ex.: 649"
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeCatalogReference(index)}
                      aria-label="Remover referência"
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button type="button" variant="secondary" onClick={addCatalogReference} className="self-start">
              <Plus className="size-4" aria-hidden />
              Adicionar referência
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
