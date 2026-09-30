/**
 * features/auth/components/SignupForm.tsx
 * Etapa "B2.4 — Signup server-controlled" — formulário de cadastro FUTURO. Só
 * é renderizado por app/signup/page.tsx quando `SIGNUP_ENABLED === "true"`
 * (fail-closed); com a flag ausente/false a página mostra a tela de Beta
 * Fechado e este componente nunca chega ao usuário.
 *
 * NÃO existe campo de senha: a conta é criada com uma senha aleatória que só
 * o servidor conhece (e descarta); o usuário define a SUA senha depois de
 * confirmar o e-mail (/auth/set-password). País: a V1 aceita só o Brasil — o
 * servidor rejeita qualquer outro valor.
 *
 * A validação daqui só espelha, para UX, a do servidor
 * (`validateSignupPayload`, função pura compartilhada) — a que vale é a de
 * POST /api/auth/signup. Termos, Privacidade, 18+ e marketing nunca vêm
 * pré-marcados; marketing é separado e opcional; o texto da declaração de
 * maioridade é exatamente o aprovado (AGE_CONFIRMATION_TEXT). O token do
 * Turnstile é de uso único e é verificado no servidor.
 */
'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { MailCheck } from 'lucide-react'

import { TurnstileWidget } from '@/components/auth/TurnstileWidget'
import { AuthShell } from '@/components/ui/AuthShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { CAPTCHA_REQUIRED_MESSAGE, useCaptcha } from '@/features/auth/use-captcha'
import { createSupabaseAuthRepository } from '@/features/auth/repositories/auth.repository'
import { SIGNUP_ALLOWED_COUNTRY, SIGNUP_ERROR_MESSAGES, validateSignupPayload } from '@/lib/auth/signup-validation'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { AGE_CONFIRMATION_TEXT, AGE_CONFIRMATION_VERSION, MARKETING_OPT_IN_TEXT, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'

const authRepository = createSupabaseAuthRepository()

const linkClass = 'text-accent underline underline-offset-2 hover:text-accent-hover'

function CheckboxField({
  id,
  checked,
  onChange,
  children,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm text-text-secondary">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent,#c9a227)]"
      />
      <span>{children}</span>
    </label>
  )
}

export function SignupForm({ captchaSiteKey }: { captchaSiteKey: string | null }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  // Nunca pré-marcados.
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [age18Confirmed, setAge18Confirmed] = useState(false)
  const [marketingOptIn, setMarketingOptIn] = useState(false)
  // A site key vem do servidor (a página decide) — mesma regra do login/reset.
  const captcha = useCaptcha(captchaSiteKey)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const payload = {
      name,
      email,
      countryCode: SIGNUP_ALLOWED_COUNTRY,
      termsAccepted,
      privacyAccepted,
      age18Confirmed,
      marketingOptIn,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
    }

    const validation = validateSignupPayload(payload)
    if (!validation.ok) {
      setError(SIGNUP_ERROR_MESSAGES[validation.code])
      return
    }

    if (captcha.enabled && !captcha.token) {
      setError(CAPTCHA_REQUIRED_MESSAGE)
      return
    }

    setIsSubmitting(true)

    try {
      // Token de uso único: consumido aqui (sucesso ou falha) e renovado pelo widget.
      const captchaToken = captcha.enabled ? captcha.consume() : null
      await authRepository.signUp({ ...payload, ...(captchaToken ? { captchaToken } : {}) })
      setSubmitted(true)
    } catch (err) {
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <AuthShell tagline="Comece a organizar sua coleção">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <MailCheck className="size-7" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Verifique seu e-mail</h2>
            <p className="mt-2 max-w-sm text-sm text-text-secondary">
              Se o cadastro puder ser concluído, enviaremos um link de confirmação para{' '}
              <span className="text-text-primary">{email}</span>. Abra o e-mail, confirme o endereço e defina sua senha.
            </p>
          </div>
          <Link href="/login" className="text-sm text-accent transition-colors hover:text-accent-hover">
            Voltar para o login
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell tagline="Comece a organizar sua coleção">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input label="País" value="Brasil" readOnly aria-readonly="true" />
          <p className="-mt-2 text-xs text-text-secondary">Por enquanto o cadastro está disponível apenas para o Brasil.</p>
          <p className="text-xs text-text-secondary">Você definirá sua senha depois de confirmar o e-mail.</p>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <CheckboxField id="signup-terms" checked={termsAccepted} onChange={setTermsAccepted}>
              Li e aceito os{' '}
              <Link href="/terms" target="_blank" className={linkClass}>
                Termos de Uso
              </Link>
              .
            </CheckboxField>
            <CheckboxField id="signup-privacy" checked={privacyAccepted} onChange={setPrivacyAccepted}>
              Li e aceito a{' '}
              <Link href="/privacy" target="_blank" className={linkClass}>
                Política de Privacidade
              </Link>
              .
            </CheckboxField>
            <CheckboxField id="signup-age" checked={age18Confirmed} onChange={setAge18Confirmed}>
              {AGE_CONFIRMATION_TEXT}
            </CheckboxField>
            <CheckboxField id="signup-marketing" checked={marketingOptIn} onChange={setMarketingOptIn}>
              {MARKETING_OPT_IN_TEXT} (opcional)
            </CheckboxField>
          </div>

          {captcha.siteKey && <TurnstileWidget siteKey={captcha.siteKey} onToken={captcha.handleToken} resetKey={captcha.resetKey} />}

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" isLoading={isSubmitting} className="mt-1 w-full">
            {isSubmitting ? 'Enviando...' : 'Criar minha conta'}
          </Button>
        </form>

        <div className="mt-6 flex justify-center border-t border-border pt-5">
          <Link href="/login" className="text-sm text-text-secondary transition-colors hover:text-accent">
            Já tenho uma conta
          </Link>
        </div>
      </Card>
    </AuthShell>
  )
}
