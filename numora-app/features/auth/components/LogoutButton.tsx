/**
 * features/auth/components/LogoutButton.tsx
 * Único ponto da UI que chama `signOut()` — via `AuthRepository`, nunca
 * `supabase-js` diretamente (PROJECT_RULES.md §4.2/§29.2).
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'

const authRepository = createSupabaseAuthRepository()

export function LogoutButton() {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogout() {
    setError(null)
    setIsSigningOut(true)

    try {
      await authRepository.signOut()
      router.replace('/login')
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
      setIsSigningOut(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="border px-3 py-1 disabled:opacity-50"
        onClick={handleLogout}
        disabled={isSigningOut}
      >
        {isSigningOut ? 'Saindo...' : 'Sair'}
      </button>
      {error && <p className="mt-2 text-sm">Erro ao sair: {error}</p>}
    </div>
  )
}
