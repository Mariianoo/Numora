/**
 * app/forgot-password/page.tsx
 * Recuperação de senha (Etapa 7). Sempre mostra a mesma mensagem de
 * sucesso, exista ou não o e-mail informado — mesmo princípio de
 * segurança contra enumeração de contas já usado no login.
 */
'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { MailCheck } from 'lucide-react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { AuthShell } from '@/components/ui/AuthShell'

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
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <AuthShell tagline="Esqueci minha senha">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <MailCheck className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Verifique seu e-mail</h2>
            <p className="mt-2 max-w-sm text-sm text-text-secondary">
              Se <span className="text-text-primary">{email}</span> estiver cadastrado, enviamos um link para
              redefinir sua senha.
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
    <AuthShell tagline="Esqueci minha senha">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" isLoading={isSubmitting} className="mt-1 w-full">
            {isSubmitting ? 'Enviando...' : 'Enviar link de recuperação'}
          </Button>
        </form>

        <div className="mt-6 flex justify-center border-t border-border pt-5">
          <Link href="/login" className="text-sm text-text-secondary transition-colors hover:text-accent">
            Voltar para o login
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}
