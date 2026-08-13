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
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { AuthShell } from '@/components/ui/AuthShell'

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
      <AuthShell tagline="Nova senha">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Senha atualizada</h2>
            <p className="mt-2 text-sm text-text-secondary">Redirecionando para o painel...</p>
          </div>
        </div>
      </AuthShell>
    )
  }

  if (linkInvalid) {
    return (
      <AuthShell tagline="Nova senha">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Link inválido ou expirado</h2>
            <p className="mt-2 text-sm text-text-secondary">Solicite um novo link de recuperação.</p>
          </div>
          <Link href="/forgot-password" className="text-sm text-accent transition-colors hover:text-accent-hover">
            Solicitar novo link
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (!isReady) {
    return (
      <AuthShell tagline="Nova senha">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
          <p className="text-sm text-text-secondary">Verificando o link de recuperação...</p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell tagline="Defina sua nova senha">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <Input
            label="Confirmar nova senha"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" isLoading={isSubmitting} className="mt-1 w-full">
            {isSubmitting ? 'Salvando...' : 'Salvar nova senha'}
          </Button>
        </form>

        <div className="mt-6 flex justify-center border-t border-border pt-5">
          <Link href="/login" className="text-sm text-text-secondary transition-colors hover:text-accent">
            Cancelar
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}
