/**
 * features/auth/components/LogoutButton.tsx
 * Único ponto da UI que chama `signOut()` — via `AuthRepository`, nunca
 * `supabase-js` diretamente (PROJECT_RULES.md §4.2/§29.2).
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

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
        onClick={handleLogout}
        disabled={isSigningOut}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogOut className="size-4" aria-hidden />
        {isSigningOut ? 'Saindo...' : 'Sair'}
      </button>
      {error && <p className="mt-2 px-3 text-sm text-danger">Erro ao sair: {error}</p>}
    </div>
  )
}
