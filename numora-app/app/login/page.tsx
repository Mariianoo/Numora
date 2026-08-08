/**
 * app/login/page.tsx
 * Página simples de login (sem estilização avançada) — apenas funcional:
 * botão de login com Google e, após autenticado, exibe o email da sessão.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import type { AuthSession } from '@/features/auth/types'

const authRepository = createSupabaseAuthRepository()

export default function LoginPage() {
  const router = useRouter()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
    // O middleware já protege as rotas; isto só evita mostrar o botão de
    // login por um instante caso o usuário chegue aqui já autenticado.
    if (session) {
      router.replace('/dashboard')
    }
  }, [session, router])

  if (isLoading || session) {
    return <p>Carregando...</p>
  }

  return (
    <div>
      <button onClick={() => authRepository.signInWithGoogle()}>Login com Google</button>
    </div>
  )
}
