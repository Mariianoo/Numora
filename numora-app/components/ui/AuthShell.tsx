/**
 * components/ui/AuthShell.tsx
 * Moldura visual compartilhada das 4 telas de autenticação (login,
 * cadastro, esqueci a senha, redefinir senha) — cabeçalho de marca +
 * glow sutil dourado de fundo. Puramente apresentacional.
 */
import type { ReactNode } from 'react'

import { NumoraLogo } from './NumoraLogo'

export interface AuthShellProps {
  tagline: string
  children: ReactNode
}

export function AuthShell({ tagline, children }: AuthShellProps) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6">
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-accent/10 blur-[110px]"
        aria-hidden
      />
      <div className="relative z-10 flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center text-center">
          <NumoraLogo variant="full" theme="dark" size={48} />
          <p className="mt-3 text-sm text-text-secondary">{tagline}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
