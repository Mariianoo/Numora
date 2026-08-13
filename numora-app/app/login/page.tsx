/**
 * app/login/page.tsx
 * Login por e-mail e senha (Etapa 7). Google OAuth fica sem uso na UI —
 * `authRepository.signInWithGoogle()` continua existindo no repositório,
 * só não é mais chamado daqui.
 */
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import type { AuthSession } from '@/features/auth/types'

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
      setError((err as Error).message)
      setIsSubmitting(false)
    }
  }

  if (isLoading || session) {
    return <p>Carregando...</p>
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">NUMORA</h1>
        <p className="text-sm">Seu patrimônio numismático em um só lugar</p>
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
        <label>
          Senha
          <input
            className="block w-full border px-2 py-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="text-sm">{error}</p>}

        <button type="submit" className="border px-3 py-1 disabled:opacity-50" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando...' : 'Entrar'}
        </button>

        <Link href="/forgot-password" className="text-sm underline">
          Esqueci minha senha
        </Link>
      </form>

      <div className="w-full max-w-sm border-t pt-4 text-center">
        <p className="text-sm">Ainda não tenho uma conta</p>
        <Link href="/signup" className="mt-2 inline-block border px-3 py-1">
          Criar minha conta
        </Link>
      </div>
    </div>
  )
}
