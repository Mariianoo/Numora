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

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MailCheck } from 'lucide-react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { createSupabaseReferenceRepository } from '@/features/collection/repositories/reference.repository'
import type { Country } from '@/features/collection/types'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { isPasswordStrong } from '@/lib/validation/password-policy'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { PasswordRequirementsList } from '@/components/ui/PasswordRequirementsList'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'
import { AuthShell } from '@/components/ui/AuthShell'

const authRepository = createSupabaseAuthRepository()
const referenceRepository = createSupabaseReferenceRepository()

export default function SignupPage() {
  const router = useRouter()

  const [countries, setCountries] = useState<Country[]>([])
  const [isLoadingCountries, setIsLoadingCountries] = useState(true)
  const [countriesError, setCountriesError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [countryCode, setCountryCode] = useState('')

  // `isLoadingCountries`/`countriesError` não são resetados no início de
  // propósito (evita setState síncrono dentro do efeito de montagem
  // abaixo — react-hooks/set-state-in-effect); ver mesmo comentário em
  // app/dashboard/collection/page.tsx.
  const loadCountries = useCallback(() => {
    return referenceRepository
      .listResidenceCountries()
      .then((result) => {
        setCountries(result)
        setCountriesError(null)
      })
      .catch((err) => setCountriesError(getUserFriendlyErrorMessage(err)))
      .finally(() => setIsLoadingCountries(false))
  }, [])

  useEffect(() => {
    loadCountries()
  }, [loadCountries])

  /**
   * Handler dedicado do clique em "Tentar novamente" — diferente de
   * `loadCountries` (chamada pelo efeito de montagem), este só é chamado
   * a partir de um onClick, então pode resetar o loading/erro de forma
   * síncrona sem acionar react-hooks/set-state-in-effect.
   */
  function handleRetryCountries() {
    setIsLoadingCountries(true)
    setCountriesError(null)
    loadCountries()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (name.trim() === '') {
      setError('Informe seu nome.')
      return
    }

    if (!isPasswordStrong(password)) {
      setError('A senha não atende aos requisitos mínimos.')
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
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (needsEmailConfirmation) {
    return (
      <AuthShell tagline="Comece a organizar sua coleção">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <MailCheck className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Verifique seu e-mail</h2>
            <p className="mt-2 max-w-sm text-sm text-text-secondary">
              Enviamos um link de confirmação para <span className="text-text-primary">{email}</span>. Abra o
              e-mail e clique no link para ativar sua conta.
            </p>
          </div>
          <Link href="/login" className="text-sm text-accent transition-colors hover:text-accent-hover">
            Voltar para o login
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell tagline="Comece a organizar sua coleção">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div className="flex flex-col gap-2">
            <PasswordInput
              label="Senha"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <PasswordRequirementsList password={password} />
          </div>
          <PasswordInput
            label="Confirmar senha"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <div className="flex flex-col gap-1.5">
            <Select
              label="País"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              disabled={isLoadingCountries || countriesError !== null}
            >
              <option value="">Selecione...</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.flagEmoji ? `${country.flagEmoji} ` : ''}
                  {country.name}
                </option>
              ))}
            </Select>
            {countriesError && (
              <p className="text-xs text-danger">
                {countriesError}{' '}
                <button
                  type="button"
                  onClick={handleRetryCountries}
                  className="font-medium underline underline-offset-2 hover:text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 rounded"
                >
                  Tentar novamente
                </button>
              </p>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button
            type="submit"
            isLoading={isSubmitting}
            disabled={!isPasswordStrong(password)}
            className="mt-1 w-full"
          >
            {isSubmitting ? 'Criando conta...' : 'Criar minha conta'}
          </Button>
        </form>

        <div className="mt-6 flex justify-center border-t border-border pt-5">
          <Link href="/login" className="text-sm text-text-secondary transition-colors hover:text-accent">
            Já tenho uma conta
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}
