/**
 * app/auth/reset-password/page.tsx
 * Redefinição de senha (Etapa 7) — chegada aqui via link de e-mail de
 * `resetPasswordForEmail`. O client Supabase (createBrowserClient, com
 * `detectSessionInUrl` ligado por padrão) processa o `code` da URL
 * automaticamente e emite o evento `PASSWORD_RECOVERY`; só então
 * mostramos o formulário. Se isso não acontecer em alguns segundos
 * (link inválido/expirado), mostramos mensagem apropriada em vez de
 * deixar a página presa em "verificando" para sempre.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'

const authRepository = createSupabaseAuthRepository()
const MIN_PASSWORD_LENGTH = 8
const LINK_VERIFICATION_TIMEOUT_MS = 5000

export default function ResetPasswordPage() {
  const router = useRouter()
  const [isReady, setIsReady] = useState(false)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    let ready = false

    const timeout = setTimeout(() => {
      if (!ready) setLinkInvalid(true)
    }, LINK_VERIFICATION_TIMEOUT_MS)

    const unsubscribe = authRepository.onPasswordRecovery(() => {
      ready = true
      clearTimeout(timeout)
      setIsReady(true)
    })

    return () => {
      clearTimeout(timeout)
      unsubscribe()
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

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
      await authRepository.updatePassword(password)
      setSuccess(true)
      setTimeout(() => {
        router.replace('/dashboard')
        router.refresh()
      }, 2000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Senha atualizada</h1>
        <p>Redirecionando para o painel...</p>
      </div>
    )
  }

  if (linkInvalid) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Link inválido ou expirado</h1>
        <p>Solicite um novo link de recuperação.</p>
        <Link href="/forgot-password" className="underline">
          Solicitar novo link
        </Link>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p>Verificando o link de recuperação...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Nova senha</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <label>
          Nova senha
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
          Confirmar nova senha
          <input
            className="block w-full border px-2 py-1"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="text-sm">{error}</p>}

        <button type="submit" className="border px-3 py-1 disabled:opacity-50" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando...' : 'Salvar nova senha'}
        </button>
      </form>

      <Link href="/login" className="text-sm underline">
        Cancelar
      </Link>
    </div>
  )
}
