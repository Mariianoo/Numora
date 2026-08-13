/**
 * app/dashboard/collection/page.tsx
 * "Minha Coleção" — primeira versão sobre o schema numismático real
 * (collection_items + purchases), substituindo a tabela antiga `coins`.
 * Só expõe um subconjunto dos campos de collection_items (ver
 * features/collection/types.ts) — organizado e usável, sem design final.
 * Protegida pelo mesmo proxy que cobre /dashboard/:path*.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'

import { createSupabaseCollectionRepository } from '@/features/collection/repositories/collection.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import type { CollectionItem, Country, Grade, Metal } from '@/features/collection/types'

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

  /** `null` = modal em modo "adicionar"; caso contrário, id do item em edição. */
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  // Informações da moeda
  const [countryCode, setCountryCode] = useState('')
  const [year, setYear] = useState('')
  const [denomination, setDenomination] = useState('')
  const [metalCode, setMetalCode] = useState('')
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Minha Coleção</h1>
          <p>{items.length} moeda(s) cadastrada(s)</p>
        </div>
        <button type="button" className="border px-3 py-1" onClick={openAddModal}>
          Adicionar moeda
        </button>
      </div>

      {error && <p className="mt-4">Erro: {error}</p>}
      {successMessage && <p className="mt-4">{successMessage}</p>}

      <div className="mt-6">
        {isLoading ? (
          <p>Carregando...</p>
        ) : items.length === 0 ? (
          <p>Nenhuma moeda cadastrada ainda. Clique em &quot;Adicionar moeda&quot; para começar.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className="border p-4">
                <p className="text-2xl" aria-hidden>
                  {item.countryFlagEmoji ?? '🪙'}
                </p>
                <p className="font-semibold">{item.denomination ?? 'Sem denominação'}</p>
                <p>
                  País: {item.countryDisplayName ?? item.countryCode ?? '—'} · Ano: {item.year ?? '—'}
                </p>
                <p>Metal: {item.metalName ?? '—'}</p>
                <p>Conservação: {item.gradeLabel ?? '—'}</p>
                <p>Quantidade: {item.quantity}</p>
                <p>Custo de aquisição: {item.purchase ? `R$ ${item.purchase.totalPrice.toFixed(2)}` : '—'}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="border px-2 py-1" onClick={() => openEditModal(item)}>
                    Editar
                  </button>
                  <button type="button" className="border px-2 py-1" onClick={() => handleDelete(item.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/50 p-6">
          <div className="w-full max-w-lg bg-white p-6 dark:bg-black">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{editingItemId === null ? 'Adicionar moeda' : 'Editar moeda'}</h2>
              <button type="button" onClick={closeModal}>
                Fechar
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
              <fieldset className="flex flex-col gap-3">
                <legend className="font-semibold">Informações da moeda</legend>

                <label>
                  País
                  <select
                    className="block w-full border px-2 py-1"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {countries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.flagEmoji ? `${country.flagEmoji} ` : ''}
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Ano
                  <input
                    className="block w-full border px-2 py-1"
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </label>

                <label>
                  Denominação
                  <input
                    className="block w-full border px-2 py-1"
                    value={denomination}
                    onChange={(e) => setDenomination(e.target.value)}
                    placeholder="Ex.: 200 Réis"
                  />
                </label>

                <label>
                  Metal
                  <select
                    className="block w-full border px-2 py-1"
                    value={metalCode}
                    onChange={(e) => setMetalCode(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {metals.map((metal) => (
                      <option key={metal.code} value={metal.code}>
                        {metal.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Peso (g)
                  <input
                    className="block w-full border px-2 py-1"
                    type="number"
                    step="any"
                    min="0"
                    value={grossWeightG}
                    onChange={(e) => setGrossWeightG(e.target.value)}
                  />
                </label>

                <label>
                  Pureza (%)
                  <input
                    className="block w-full border px-2 py-1"
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    value={purityPercent}
                    onChange={(e) => setPurityPercent(e.target.value)}
                    placeholder="Ex.: 90"
                  />
                </label>

                <label>
                  Conservação
                  <select
                    className="block w-full border px-2 py-1"
                    value={gradeId}
                    onChange={(e) => setGradeId(e.target.value)}
                  >
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
                  </select>
                </label>

                <label>
                  Valor de face
                  <input
                    className="block w-full border px-2 py-1"
                    type="number"
                    step="any"
                    min="0"
                    value={faceValue}
                    onChange={(e) => setFaceValue(e.target.value)}
                  />
                </label>

                <label>
                  Quantidade
                  <input
                    className="block w-full border px-2 py-1"
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </label>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="font-semibold">Aquisição</legend>

                <label>
                  Preço pago
                  <input
                    className="block w-full border px-2 py-1"
                    type="number"
                    step="any"
                    min="0"
                    value={pricePaid}
                    onChange={(e) => setPricePaid(e.target.value)}
                  />
                </label>

                <label>
                  Data da compra
                  <input
                    className="block w-full border px-2 py-1"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </label>

                <label>
                  Vendedor
                  <input
                    className="block w-full border px-2 py-1"
                    value={sellerName}
                    onChange={(e) => setSellerName(e.target.value)}
                  />
                </label>

                <label>
                  Observação
                  <input
                    className="block w-full border px-2 py-1"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
              </fieldset>

              <div className="flex gap-2">
                <button type="submit" className="border px-3 py-1" disabled={isSaving}>
                  {isSaving ? 'Salvando...' : 'Salvar'}
                </button>
                <button type="button" className="border px-3 py-1" onClick={closeModal} disabled={isSaving}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
