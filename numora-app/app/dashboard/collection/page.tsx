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
 */
'use client'

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Coins, ClipboardList, Landmark, Pencil, PackageOpen, Plus, Receipt, Search, Trash2 } from 'lucide-react'

import { createSupabaseCollectionRepository } from '@/features/collection/repositories/collection.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import type { CollectionItem, Country, Grade, Metal } from '@/features/collection/types'
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

const GRADE_SCALE_LABELS: Record<string, string> = {
  br: 'Escala brasileira',
  sheldon: 'Escala Sheldon',
}

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

  // Busca e filtros — somente client-side, sobre os itens já carregados.
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterMetal, setFilterMetal] = useState('')
  const [filterGrade, setFilterGrade] = useState('')

  /** `null` = modal em modo "adicionar"; caso contrário, id do item em edição. */
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  // Informações da moeda
  const [countryCode, setCountryCode] = useState('')
  const [year, setYear] = useState('')
  const [denomination, setDenomination] = useState('')
  const [metalCode, setMetalCode] = useState('')

  // Características
  const [grossWeightG, setGrossWeightG] = useState('')
  const [purityPercent, setPurityPercent] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [faceValue, setFaceValue] = useState('')
  const [quantity, setQuantity] = useState('1')

  // Aquisição
  const [pricePaid, setPricePaid] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [notes, setNotes] = useState('')

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
      if (filterGrade && item.gradeId !== filterGrade) return false

      if (term === '') return true

      const haystack = [item.denomination, item.countryDisplayName, item.metalName, item.gradeLabel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(term)
    })
  }, [items, searchTerm, filterCountry, filterMetal, filterGrade])

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)

  function resetForm() {
    setCountryCode('')
    setYear('')
    setDenomination('')
    setMetalCode('')
    setGrossWeightG('')
    setPurityPercent('')
    setGradeId('')
    setFaceValue('')
    setQuantity('1')
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
    setIsModalOpen(true)
  }

  function openEditModal(item: CollectionItem) {
    setError(null)
    setSuccessMessage(null)
    setEditingItemId(item.id)
    setCountryCode(item.countryCode ?? '')
    setYear(item.year !== null ? String(item.year) : '')
    setDenomination(item.denomination ?? '')
    setMetalCode(item.metalCode ?? '')
    setGrossWeightG(item.grossWeightG !== null ? String(item.grossWeightG) : '')
    setPurityPercent(purityToPercentString(item.purity))
    setGradeId(item.gradeId ?? '')
    setFaceValue(item.faceValue !== null ? String(item.faceValue) : '')
    setQuantity(String(item.quantity))
    setPricePaid(item.purchase !== null ? String(item.purchase.totalPrice) : '')
    setPurchaseDate(item.purchase?.purchaseDate ?? '')
    setSellerName(item.purchase?.sellerName ?? '')
    setNotes(item.purchase?.notes ?? '')
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingItemId(null)
    resetForm()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    setError(null)
    setIsSaving(true)

    const parsedQuantity = Number.parseInt(quantity, 10)
    const totalPrice = toNullableNumber(pricePaid)

    const input = {
      countryCode: toNullableText(countryCode),
      year: toNullableInt(year),
      denomination: toNullableText(denomination),
      metalCode: toNullableText(metalCode),
      grossWeightG: toNullableNumber(grossWeightG),
      purity: percentStringToPurity(purityPercent),
      gradeId: toNullableText(gradeId),
      faceValue: toNullableNumber(faceValue),
      quantity: Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1,
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
    const confirmed = window.confirm('Tem certeza que deseja excluir esta moeda?')
    if (!confirmed) return

    setError(null)

    try {
      await collectionRepository.remove(id)
      setItems((current) => current.filter((item) => item.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const hasActiveFilters = searchTerm !== '' || filterCountry !== '' || filterMetal !== '' || filterGrade !== ''

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
            <div className="grid grid-cols-3 gap-3 sm:w-auto sm:shrink-0">
              <Select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                aria-label="Filtrar por país"
              >
                <option value="">País</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
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
              <Select
                value={filterGrade}
                onChange={(e) => setFilterGrade(e.target.value)}
                aria-label="Filtrar por conservação"
              >
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
                    {item.metalName && <Badge tone="accent">{item.metalName}</Badge>}
                    {item.gradeLabel && <Badge tone="neutral">{item.gradeLabel}</Badge>}
                  </div>
                  {item.quantity > 1 && (
                    <span className="shrink-0 text-xs font-medium text-text-secondary">×{item.quantity}</span>
                  )}
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
              <Input label="Ano" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </FieldRow>

            <FieldRow>
              <Input
                label="Denominação"
                value={denomination}
                onChange={(e) => setDenomination(e.target.value)}
                placeholder="Ex.: 200 Réis"
              />
              <Select label="Metal" value={metalCode} onChange={(e) => setMetalCode(e.target.value)}>
                <option value="">Selecione...</option>
                {metals.map((metal) => (
                  <option key={metal.code} value={metal.code}>
                    {metal.name}
                  </option>
                ))}
              </Select>
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
              <Select label="Conservação" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
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
              <Input
                label="Quantidade"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
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
    </div>
  )
}
