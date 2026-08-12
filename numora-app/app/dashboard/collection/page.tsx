/**
 * app/dashboard/collection/page.tsx
 * "Minha Coleção" — organizado e usável, sem design avançado. Protegida
 * pelo mesmo middleware que cobre /dashboard/:path*.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'

import { createSupabaseCoinsRepository } from '@/features/coins/repositories/coins.repository'
import { COIN_LIMIT_REACHED_MESSAGE, FREE_TIER_COIN_LIMIT } from '@/features/coins/constants'
import type { Coin } from '@/features/coins/types'

const coinsRepository = createSupabaseCoinsRepository()

function toNullableNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

export default function CollectionPage() {
  const [coins, setCoins] = useState<Coin[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  /** `null` = modal em modo "adicionar"; caso contrário, id da moeda em edição. */
  const [editingCoinId, setEditingCoinId] = useState<string | null>(null)

  const [country, setCountry] = useState('')
  const [year, setYear] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [pricePaid, setPricePaid] = useState('')

  useEffect(() => {
    coinsRepository
      .list()
      .then(setCoins)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  const total = coins.reduce((sum, coin) => sum + (coin.pricePaid ?? 0), 0)
  const limitReached = coins.length >= FREE_TIER_COIN_LIMIT

  function resetForm() {
    setCountry('')
    setYear('')
    setValue('')
    setDescription('')
    setPricePaid('')
  }

  function openAddModal() {
    setError(null)
    setSuccessMessage(null)
    setEditingCoinId(null)
    resetForm()
    setIsModalOpen(true)
  }

  function openEditModal(coin: Coin) {
    setError(null)
    setSuccessMessage(null)
    setEditingCoinId(coin.id)
    setCountry(coin.country)
    setYear(coin.year !== null ? String(coin.year) : '')
    setValue(coin.value !== null ? String(coin.value) : '')
    setDescription(coin.description ?? '')
    setPricePaid(coin.pricePaid !== null ? String(coin.pricePaid) : '')
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingCoinId(null)
    resetForm()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (editingCoinId === null && limitReached) {
      setError(COIN_LIMIT_REACHED_MESSAGE)
      return
    }

    setError(null)
    setIsSaving(true)

    const input = {
      country,
      year: toNullableNumber(year),
      value: toNullableNumber(value),
      description: description.trim() === '' ? null : description,
      pricePaid: toNullableNumber(pricePaid),
    }

    try {
      if (editingCoinId === null) {
        const newCoin = await coinsRepository.create(input)
        setCoins((current) => [newCoin, ...current])
        setSuccessMessage('Moeda adicionada com sucesso.')
      } else {
        const updatedCoin = await coinsRepository.update(editingCoinId, input)
        setCoins((current) => current.map((coin) => (coin.id === updatedCoin.id ? updatedCoin : coin)))
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
      await coinsRepository.remove(id)
      setCoins((current) => current.filter((coin) => coin.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Minha Coleção</h1>
          <p>Total pago pela coleção: {total.toFixed(2)}</p>
          <p>
            {coins.length}/{FREE_TIER_COIN_LIMIT} moedas (plano free)
          </p>
        </div>
        <button
          type="button"
          className="border px-3 py-1 disabled:opacity-50"
          onClick={openAddModal}
          disabled={limitReached}
        >
          Adicionar moeda
        </button>
      </div>

      {limitReached && <p className="mt-4">{COIN_LIMIT_REACHED_MESSAGE}</p>}
      {error && <p className="mt-4">Erro: {error}</p>}
      {successMessage && <p className="mt-4">{successMessage}</p>}

      <div className="mt-6">
        {isLoading ? (
          <p>Carregando...</p>
        ) : coins.length === 0 ? (
          <p>Nenhuma moeda cadastrada.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {coins.map((coin) => (
              <div key={coin.id} className="border p-4">
                <p>País: {coin.country}</p>
                <p>Ano: {coin.year ?? '—'}</p>
                <p>Valor: {coin.value ?? '—'}</p>
                <p>Preço pago: {coin.pricePaid ?? '—'}</p>
                {coin.description && <p>Descrição: {coin.description}</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" className="border px-2 py-1" onClick={() => openEditModal(coin)}>
                    Editar
                  </button>
                  <button type="button" className="border px-2 py-1" onClick={() => handleDelete(coin.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm bg-white p-6 dark:bg-black">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{editingCoinId === null ? 'Adicionar moeda' : 'Editar moeda'}</h2>
              <button type="button" onClick={closeModal}>
                Fechar
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
              <label>
                País
                <input
                  className="block w-full border px-2 py-1"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  required
                />
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
                Valor
                <input
                  className="block w-full border px-2 py-1"
                  type="number"
                  step="any"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <label>
                Descrição
                <input
                  className="block w-full border px-2 py-1"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                Preço pago
                <input
                  className="block w-full border px-2 py-1"
                  type="number"
                  step="any"
                  value={pricePaid}
                  onChange={(e) => setPricePaid(e.target.value)}
                />
              </label>
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
