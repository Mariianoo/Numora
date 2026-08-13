/**
 * app/forgot-password/page.tsx
 * Recuperação de senha (Etapa 7). Sempre mostra a mesma mensagem de
 * sucesso, exista ou não o e-mail informado — mesmo princípio de
 * segurança contra enumeração de contas já usado no login.
 */
'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'

const authRepository = createSupabaseAuthRepository()

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await authRepository.requestPasswordReset(email)
      setSubmitted(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Verifique seu e-mail</h1>
        <p>Se {email} estiver cadastrado, enviamos um link para redefinir sua senha.</p>
        <Link href="/login" className="underline">
          Voltar para o login
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Esqueci minha senha</h1>
        <p className="text-sm">Informe seu e-mail para receber o link de redefinição</p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
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

        {error && <p className="text-sm">{error}</p>}

        <button type="submit" className="border px-3 py-1 disabled:opacity-50" disabled={isSubmitting}>
          {isSubmitting ? 'Enviando...' : 'Enviar link de recuperação'}
        </button>
      </form>

      <Link href="/login" className="text-sm underline">
        Voltar para o login
      </Link>
    </div>
  )
}
