/**
 * app/signup/page.tsx
 * Tela informativa de Beta Fechado (Etapa "Closed Beta UX"). O cadastro
 * público foi desabilitado no Supabase Auth Production (disable_signup) —
 * esta página deixou de ter um formulário funcional de propósito, para não
 * dar a entender que o cadastro está aberto. Server Component estático,
 * sem sessão, mesmo padrão de app/privacy/page.tsx.
 *
 * Reaproveita AuthShell (mesma moldura de login/forgot-password/
 * reset-password) — nenhum componente novo foi criado.
 *
 * Etapa "B2 — Signup + Legal": a página passou a decidir NO SERVIDOR, a
 * cada requisição (`force-dynamic`), se o formulário de cadastro existe —
 * só com `SIGNUP_ENABLED === "true"` (fail-closed; ver lib/auth/signup-flag.ts)
 * E a configuração completa do endpoint (origem canônica, Resend, Turnstile —
 * obrigatório em Production; ver lib/auth/signup-config.ts). Em QUALQUER outro
 * caso o comportamento é exatamente o de antes: tela de Beta Fechado, sem
 * formulário. (Etapa B2.4: a V1 aceita só o Brasil, então a página não lista
 * mais países.)
 */
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

import { Card } from '@/components/ui/Card'
import { AuthShell } from '@/components/ui/AuthShell'
import { SignupForm } from '@/features/auth/components/SignupForm'
import { resolveSignupConfig } from '@/lib/auth/signup-config'
import { isSignupEnabled } from '@/lib/auth/signup-flag'
import { getTurnstileSiteKey } from '@/lib/captcha/captcha'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Beta Fechado — Numora',
}

export default function SignupPage() {
  if (isSignupEnabled() && resolveSignupConfig(process.env).ok) {
    return <SignupForm captchaSiteKey={getTurnstileSiteKey()} />
  }

  return <ClosedSignup />
}

function ClosedSignup() {
  return (
    <AuthShell tagline="Sua coleção. Sua história.">
      <Card className="w-full max-w-sm p-7">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Sparkles className="size-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Beta Fechado</h1>
            <p className="mt-2 text-sm text-text-secondary">
              O cadastro do Numora está temporariamente fechado. O acesso nesta fase está disponível somente por
              convite.
            </p>
          </div>
          <Link
            href="/login"
            className="flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-background shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Já tenho acesso
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}
