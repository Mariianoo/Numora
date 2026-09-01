/**
 * app/login/page.tsx
 * Login por e-mail e senha (Etapa 7). Google OAuth fica sem uso na UI —
 * `authRepository.signInWithGoogle()` continua existindo no repositório,
 * só não é mais chamado daqui.
 *
 * `router.replace()` + `router.refresh()` juntos (mesmo padrão já usado em
 * app/signup/page.tsx e app/auth/reset-password/page.tsx): sem o refresh,
 * a navegação client-side pode reaproveitar um payload RSC de /dashboard
 * já em cache no Router Cache do App Router (de uma visita anterior na
 * mesma aba), renderizado com dados antigos — nesse caso, `profiles.name`
 * (usado na saudação) ficava desatualizado até um reload completo (F5),
 * que sempre ignora esse cache client-side. `refresh()` força o
 * Server Component de /dashboard a rodar de novo com a sessão atual.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import type { AuthSession } from '@/features/auth/types'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Card } from '@/components/ui/Card'
import { AuthShell } from '@/components/ui/AuthShell'

const authRepository = createSupabaseAuthRepository()

export default function LoginPage() {
  const router = useRouter()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    authRepository.getSession().then((currentSession) => {
      setSession(currentSession)
      setIsLoading(false)
    })

    return authRepository.onAuthStateChange((nextSession) => {
      setSession(nextSession)
    })
  }, [])

  useEffect(() => {
    // proxy.ts não valida a sessão de verdade em /login (só checa presença
    // de cookie em /dashboard) — este redirect aqui é quem efetivamente
    // tira o usuário já logado da tela de login, validando a sessão de
    // verdade via supabase-js.
    if (session) {
      router.replace('/dashboard')
      router.refresh()
    }
  }, [session, router])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await authRepository.signInWithPassword(email, password)
      // onAuthStateChange (acima) atualiza `session`; o efeito redireciona.
    } catch (err) {
      setError(getUserFriendlyErrorMessage(err))
      setIsSubmitting(false)
    }
  }

  if (isLoading || session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-text-secondary" aria-hidden />
      </div>
    )
  }

  return (
    <AuthShell tagline="Sua coleção. Sua história.">
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
          <PasswordInput
            label="Senha"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" isLoading={isSubmitting} className="mt-1 w-full">
            {isSubmitting ? 'Entrando...' : 'Entrar'}
          </Button>

          <Link
            href="/forgot-password"
            className="text-center text-sm text-text-secondary transition-colors hover:text-accent"
          >
            Esqueci minha senha
          </Link>
        </form>

        <div className="mt-6 flex flex-col items-center gap-3 border-t border-border pt-5">
          <p className="text-sm text-text-secondary">Ainda não tenho uma conta</p>
          <Link
            href="/signup"
            className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface-hover text-sm font-medium text-text-primary transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Criar minha conta
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}
