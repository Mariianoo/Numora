/**
 * app/dashboard/feedback/page.tsx
 * "Enviar feedback" (Etapa "F3 — Numora Feedback") — formulário simples,
 * mesmo padrão de app/dashboard/profile/page.tsx (Client Component,
 * `createSupabase*Repository()` no módulo, nunca SQL direto aqui).
 *
 * Sem popup automático, sem interromper o usuário — só uma página normal
 * do dashboard, acessível pela Sidebar quando o usuário quiser.
 */
'use client'

import { useState, type FormEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { createSupabaseFeedbackRepository } from '@/features/feedback/repositories/feedback.repository'
import type { FeedbackType } from '@/features/feedback/types'
import { MAX_MESSAGE_LENGTH, MAX_TITLE_LENGTH, validateFeedbackInput } from '@/features/feedback/validation'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/utils'

const feedbackRepository = createSupabaseFeedbackRepository()

const TYPE_OPTIONS: { value: FeedbackType; label: string; emoji: string }[] = [
  { value: 'praise', label: 'Elogio', emoji: '❤️' },
  { value: 'suggestion', label: 'Sugestão', emoji: '💡' },
  { value: 'problem', label: 'Encontrei um problema', emoji: '🐛' },
]

export default function FeedbackPage() {
  const [type, setType] = useState<FeedbackType>('praise')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [wantsContact, setWantsContact] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const validationError = validateFeedbackInput({ type, title, message })
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSubmitting(true)
    try {
      await feedbackRepository.create({ type, title, message, wantsContact })
      setIsSubmitted(true)
    } catch (err) {
      setError(getUserFriendlyErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSendAnother() {
    setIsSubmitted(false)
    setType('praise')
    setTitle('')
    setMessage('')
    setWantsContact(false)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Envie seu feedback"
        description="Ajude a melhorar o Numora. Conte o que você está achando, sugira uma melhoria ou relate um problema."
      />

      <Card className="max-w-2xl p-6 sm:p-8">
        {isSubmitted ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <CheckCircle2 className="size-7" aria-hidden />
            </div>
            <p className="max-w-sm text-sm text-text-secondary">
              Obrigado pelo seu feedback! Ele foi registrado e ajuda a construir o futuro do Numora.
            </p>
            <Button type="button" variant="secondary" onClick={handleSendAnother}>
              Enviar outro feedback
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-secondary">Tipo de feedback</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {TYPE_OPTIONS.map((option) => {
                  const isSelected = type === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setType(option.value)}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                        isSelected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                      )}
                    >
                      <span className="text-2xl" aria-hidden>
                        {option.emoji}
                      </span>
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <Input
              label="Título"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={MAX_TITLE_LENGTH}
              required
            />

            <Textarea
              label="Mensagem"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={5}
              required
            />

            <label className="flex items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={wantsContact}
                onChange={(event) => setWantsContact(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-border accent-accent"
              />
              Quero que a equipe do Numora entre em contato comigo sobre este feedback.
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button type="submit" isLoading={isSubmitting} className="sm:w-fit">
              {isSubmitting ? 'Enviando...' : 'Enviar feedback'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
