/**
 * app/auth/set-password/page.tsx
 * Etapa "B2.4 — Signup server-controlled" — o usuário define a SUA senha
 * depois de confirmar o e-mail. A conta nasceu com uma senha aleatória que
 * ninguém conhece; sem sessão (que só existe depois do `verifyOtp` de
 * /api/auth/confirm) não há como definir senha aqui — a página mostra uma
 * mensagem e o usuário volta ao login.
 *
 * Política de senha: a mesma de cadastro/redefinição
 * (lib/validation/password-policy.ts). A troca é `updateUser({ password })`
 * feita pelo próprio usuário autenticado. Senha nunca é registrada nem
 * enviada a nenhum serviço de monitoramento.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { validatePassword } from '@/lib/validation/password-policy'
import { Button } from '@/components/ui/Button'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { PasswordRequirementsList } from '@/components/ui/PasswordRequirementsList'
import { Card } from '@/components/ui/Card'
import { AuthShell } from '@/components/ui/AuthShell'

const authRepository = createSupabaseAuthRepository()

type SessionState = 'checking' | 'ready' | 'missing'

export default function SetPasswordPage() {
  const router = useRouter()
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    authRepository
      .getSession()
      .then((session) => setSessionState(session ? 'ready' : 'missing'))
      .catch(() => setSessionState('missing'))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!validatePassword(password).valid) {
      setError('A senha não atende aos requisitos mínimos.')
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
      }, 1200)
    } catch (err) {
      setError(getUserFriendlyErrorMessage(err))
      setIsSubmitting(false)
    }
  }

  if (sessionState === 'checking') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
      </div>
    )
  }

  if (sessionState === 'missing') {
    return (
      <AuthShell tagline="Defina sua senha">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Sessão não encontrada</h2>
            <p className="mt-2 max-w-sm text-sm text-text-secondary">
              Para definir sua senha, abra o link de confirmação enviado ao seu e-mail. Se ele expirou, faça o cadastro novamente.
            </p>
          </div>
          <Link href="/login" className="text-sm text-accent transition-colors hover:text-accent-hover">
            Ir para o login
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (success) {
    return (
      <AuthShell tagline="Defina sua senha">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Senha definida</h2>
            <p className="mt-2 text-sm text-text-secondary">Sua conta está pronta. Redirecionando...</p>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell tagline="Defina sua senha">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">Seu e-mail foi confirmado. Agora defina a senha que você usará para entrar.</p>
          <div className="flex flex-col gap-2">
            <PasswordInput
              label="Nova senha"
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

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" isLoading={isSubmitting} disabled={!validatePassword(password).valid} className="mt-1 w-full">
            {isSubmitting ? 'Salvando...' : 'Definir senha'}
          </Button>
        </form>
      </Card>
    </AuthShell>
  )
}
