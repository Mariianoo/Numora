/**
 * app/forgot-password/page.tsx
 * Etapa "B2.5.2 — Hardening explícito do CAPTCHA": este arquivo virou um
 * Server Component fino, pelo mesmo motivo de app/login/page.tsx —
 * `CAPTCHA_REQUIRED` só pode ser lido no servidor. Resolve a política uma
 * única vez por requisição (`resolveClientCaptchaPolicy`) e repassa só a
 * site key pública (nunca a secret) para
 * features/auth/components/ForgotPasswordForm.tsx, que mantém toda a lógica
 * do fluxo (inalterada).
 *
 * `CAPTCHA_REQUIRED=true` sem a site key configurada é fail-closed: mostra
 * indisponibilidade em vez de um formulário sem proteção.
 */
import { resolveClientCaptchaPolicy } from '@/lib/captcha/captcha'
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm'
import { AuthShell } from '@/components/ui/AuthShell'
import { Card } from '@/components/ui/Card'

export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage() {
  const captcha = resolveClientCaptchaPolicy(process.env)

  if (!captcha.ok) {
    return (
      <AuthShell tagline="Esqueci minha senha">
        <Card className="w-full max-w-sm p-7">
          <p className="text-sm text-danger" role="alert">
            A recuperação de senha está temporariamente indisponível. Tente novamente em alguns instantes.
          </p>
        </Card>
      </AuthShell>
    )
  }

  return <ForgotPasswordForm captchaSiteKey={captcha.siteKey} />
}
