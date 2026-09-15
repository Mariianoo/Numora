/**
 * app/admin/members/GrantCourtesyModal.tsx
 * Formulário de concessão de cortesia (Etapa 15.3 §7) — grava em
 * `benefit_grants` via `AdminRepository.grantCourtesy`, que já encadeia o
 * registro em `admin_audit_logs` (log_admin_action). Nunca altera
 * `profiles.plan_tier` diretamente — a cortesia é um registro à parte, com
 * vigência própria (ver comentário da migration `create_benefit_grants`).
 *
 * Etapa "5.10U.2 — UX de Concessão de Cortesia": achado real — o campo
 * "Expira em" não tinha NENHUMA validação de data antes do submit (nem
 * `min` nativo, nem checagem em JS), então uma data já passada (ex.:
 * meses atrás) só era barrada pelo Postgres
 * (`chk_benefit_grants_expires_after_starts`, migration
 * `create_benefit_grants`, NUNCA alterada aqui), e o erro técnico cru do
 * banco chegava direto à tela do admin. Correção mínima, só neste arquivo:
 * `min` no input nativo (primeira barreira, cosmética) +
 * `validateExpiresAt()` (barreira real, mesma semântica da constraint) +
 * tradução do erro conhecido no catch. Nenhuma mudança de `starts_at`
 * (continua `now()` no INSERT, nunca enviado pelo client) nem da
 * constraint em si.
 *
 * `validateExpiresAt`/`EXPIRES_AT_INVALID_MESSAGE` exportados só para
 * teste unitário isolado (mesmo padrão de `validateFeedbackInput`,
 * features/feedback/validation.ts) — nenhum outro consumidor previsto.
 */
'use client'

import { useState } from 'react'
import { Gift } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { endOfDayLocalISOString } from '@/lib/format/date'
import { getUserFriendlyErrorMessage } from '@/lib/errors/get-user-friendly-error-message'
import type { AdminMember, BenefitType } from '@/features/admin/types'

const BENEFIT_TYPE_LABELS: Record<BenefitType, string> = {
  trial: 'Trial',
  courtesy: 'Cortesia',
  partnership: 'Parceria',
  beta: 'Beta',
  admin: 'Administrativo',
}

export const EXPIRES_AT_INVALID_MESSAGE =
  'Data de expiração inválida. Escolha uma data futura ou deixe o campo vazio para uma cortesia sem prazo.'

/** Nome literal da constraint (create_benefit_grants.sql) — Postgres sempre inclui o nome da constraint violada na mensagem de erro, mesmo depois de embrulhada por AdminRepository. */
const EXPIRES_AT_CONSTRAINT_NAME = 'chk_benefit_grants_expires_after_starts'

/**
 * Espelha exatamente `chk_benefit_grants_expires_after_starts`
 * (`expires_at is null or expires_at > starts_at`, `starts_at` = `now()`
 * no INSERT) — `''` (campo vazio) é sempre válido, cortesia sem prazo.
 * Comparação SEMPRE em instantes absolutos via `endOfDayLocalISOString`
 * (a MESMA função usada no submit real, abaixo) — nunca comparando
 * strings de data local, para nunca divergir do que é de fato enviado ao
 * banco nem sofrer um bug de "um dia a mais/a menos" por fuso horário.
 * `now` é injetável só para teste determinístico (default `new Date()`).
 */
export function validateExpiresAt(value: string, now: Date = new Date()): string | null {
  if (value === '') return null

  const expiresAtInstant = new Date(endOfDayLocalISOString(value)).getTime()
  if (expiresAtInstant <= now.getTime()) {
    return EXPIRES_AT_INVALID_MESSAGE
  }
  return null
}

/** Exportada só para teste unitário isolado, mesmo motivo de `validateExpiresAt` acima. */
export function isExpiresAtConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return message.includes(EXPIRES_AT_CONSTRAINT_NAME)
}

/** Só para o atributo `min` nativo do `<input type="date">` — primeira barreira (cosmética, não substitui `validateExpiresAt`). Mesmo formato `YYYY-MM-DD` já usado em outras telas (ex.: app/dashboard/collection/page.tsx). */
function todayDateOnly(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export interface GrantCourtesyModalProps {
  member: AdminMember | null
  onClose: () => void
  onSubmit: (input: { type: BenefitType; plan: string; reason: string; expiresAt: string | null }) => Promise<void>
}

export function GrantCourtesyModal({ member, onClose, onSubmit }: GrantCourtesyModalProps) {
  const [type, setType] = useState<BenefitType>('courtesy')
  const [plan, setPlan] = useState('pro')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derivado a cada render (nunca um state próprio sincronizado à parte) —
  // sempre reflete o `expiresAt` atual, sem risco de ficar desatualizado.
  const dateError = validateExpiresAt(expiresAt)

  if (!member) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // Defesa adicional além do botão desabilitado (ex.: submit via Enter)
    // — nunca deveria ser alcançável na prática, mas custa nada garantir.
    if (dateError) return

    setError(null)
    setIsSubmitting(true)

    try {
      await onSubmit({
        type,
        plan,
        reason: reason.trim() || '',
        expiresAt: expiresAt ? endOfDayLocalISOString(expiresAt) : null,
      })
    } catch (err) {
      // Etapa 5.10U.2 — nunca mostra a mensagem técnica crua do Postgres.
      // Erro CONHECIDO (a mesma constraint que a validação acima já tenta
      // evitar, mas pode ainda ocorrer por uma corrida de relógio/TOCTOU)
      // recebe a MESMA mensagem amigável específica; qualquer outro erro
      // passa pelo tradutor genérico já usado no resto do app.
      setError(isExpiresAtConstraintViolation(err) ? EXPIRES_AT_INVALID_MESSAGE : getUserFriendlyErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={Boolean(member)}
      onClose={onClose}
      title="Conceder cortesia"
      description={`${member.name ?? member.email ?? member.numoraId} vai receber acesso a um plano sem cobrança.`}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg bg-accent/5 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Gift className="size-[18px]" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">
            A cortesia tem vigência própria e nunca altera o plano diretamente — o benefício expira sozinho na data
            escolhida (ou fica sem prazo, se deixada em branco).
          </p>
        </div>

        <Select label="Tipo" value={type} onChange={(event) => setType(event.target.value as BenefitType)}>
          {(Object.keys(BENEFIT_TYPE_LABELS) as BenefitType[]).map((key) => (
            <option key={key} value={key}>
              {BENEFIT_TYPE_LABELS[key]}
            </option>
          ))}
        </Select>

        <Select label="Plano concedido" value={plan} onChange={(event) => setPlan(event.target.value)}>
          <option value="pro">Pro</option>
          <option value="premium">Premium</option>
        </Select>

        <Input
          label="Expira em (opcional)"
          type="date"
          min={todayDateOnly()}
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          error={dateError ?? undefined}
        />

        <Textarea
          label="Motivo (opcional)"
          placeholder="Ex.: parceiro do Numora, cortesia de lançamento..."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmitting} disabled={dateError !== null}>
            Conceder cortesia
          </Button>
        </div>
      </form>
    </Modal>
  )
}
