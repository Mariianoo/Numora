/**
 * app/login/page.tsx
 * Etapa "B2.5.2 — Hardening explícito do CAPTCHA": este arquivo virou um
 * Server Component fino. A decisão de EXIGIR CAPTCHA (`CAPTCHA_REQUIRED`) só
 * pode ser lida no servidor (variável sem prefixo `NEXT_PUBLIC_`, nunca
 * inlinada no bundle do cliente) — aqui resolvemos a política uma única vez
 * por requisição (`resolveClientCaptchaPolicy`, lib/captcha/captcha.ts, a
 * MESMA função usada por app/forgot-password/page.tsx) e repassamos só o
 * necessário (a site key pública; nunca a secret) para
 * features/auth/components/LoginForm.tsx, que mantém toda a lógica de login
 * (inalterada — ver o cabeçalho daquele arquivo).
 *
 * `CAPTCHA_REQUIRED=true` sem a site key configurada é fail-closed: a tela
 * mostra uma mensagem de indisponibilidade em vez de um formulário que
 * prometeria proteção e não teria como cumprir.
 */
import { resolveClientCaptchaPolicy } from '@/lib/captcha/captcha'
import { LoginForm } from '@/features/auth/components/LoginForm'
import { AuthShell } from '@/components/ui/AuthShell'
import { Card } from '@/components/ui/Card'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const captcha = resolveClientCaptchaPolicy(process.env)

  if (!captcha.ok) {
    return (
      <AuthShell tagline="Sua coleção. Sua história.">
        <Card className="w-full max-w-sm p-7">
          <p className="text-sm text-danger" role="alert">
            O login está temporariamente indisponível. Tente novamente em alguns instantes.
          </p>
        </Card>
      </AuthShell>
    )
  }

  return <LoginForm captchaSiteKey={captcha.siteKey} />
}
