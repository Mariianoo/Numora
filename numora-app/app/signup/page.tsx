/**
 * app/signup/page.tsx
 * Cadastro por e-mail e senha (Etapa 7). "Confirm email" está habilitado
 * neste projeto (confirmado empiricamente antes da implementação) — após
 * o cadastro, mostra instrução para confirmar o e-mail em vez de logar
 * direto.
 *
 * Reaproveita `ReferenceRepository`/`Country` de features/collection —
 * único repositório existente que já lista `countries`; não duplicamos
 * essa leitura aqui.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import type { Country } from '@/features/collection/types'

const authRepository = createSupabaseAuthRepository()
const referenceRepository = createSupabaseReferenceRepository()

const MIN_PASSWORD_LENGTH = 8

export default function SignupPage() {
  const router = useRouter()

  const [countries, setCountries] = useState<Country[]>([])
  const [isLoadingCountries, setIsLoadingCountries] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [countryCode, setCountryCode] = useState('')

  useEffect(() => {
    referenceRepository
      .listCountries()
      .then(setCountries)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoadingCountries(false))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (name.trim() === '') {
      setError('Informe seu nome.')
      return
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await authRepository.signUp({
        name,
        email,
        password,
        countryCode: countryCode === '' ? null : countryCode,
      })

      if (result.hasSession) {
        router.replace('/dashboard')
        router.refresh()
        return
      }

      setNeedsEmailConfirmation(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (needsEmailConfirmation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Verifique seu e-mail</h1>
        <p>Enviamos um link de confirmação para {email}. Abra o e-mail e clique no link para ativar sua conta.</p>
        <Link href="/login" className="underline">
          Voltar para o login
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Criar conta</h1>
        <p className="text-sm">Comece a organizar sua coleção no Numora</p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <label>
          Nome
          <input
            className="block w-full border px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          E-mail
          <input
            className="block w-full border px-2 py-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Senha
          <input
            className="block w-full border px-2 py-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <label>
          Confirmar senha
          <input
            className="block w-full border px-2 py-1"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>
        <label>
          País
          <select
            className="block w-full border px-2 py-1"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            disabled={isLoadingCountries}
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

        {error && <p className="text-sm">{error}</p>}

        <button type="submit" className="border px-3 py-1 disabled:opacity-50" disabled={isSubmitting}>
          {isSubmitting ? 'Criando conta...' : 'Criar minha conta'}
        </button>
      </form>

      <Link href="/login" className="text-sm underline">
        Já tenho uma conta
      </Link>
    </div>
  )
}
