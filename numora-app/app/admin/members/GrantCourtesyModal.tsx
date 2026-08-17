/**
 * app/admin/members/GrantCourtesyModal.tsx
 * Formulário de concessão de cortesia (Etapa 15.3 §7) — grava em
 * `benefit_grants` via `AdminRepository.grantCourtesy`, que já encadeia o
 * registro em `admin_audit_logs` (log_admin_action). Nunca altera
 * `profiles.plan_tier` diretamente — a cortesia é um registro à parte, com
 * vigência própria (ver comentário da migration `create_benefit_grants`).
 */
'use client'

import { useState } from 'react'
import { Gift } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import type { AdminMember, BenefitType } from '@/features/admin/types'

const BENEFIT_TYPE_LABELS: Record<BenefitType, string> = {
  trial: 'Trial',
  courtesy: 'Cortesia',
  partnership: 'Parceria',
  beta: 'Beta',
  admin: 'Administrativo',
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

  if (!member) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await onSubmit({
        type,
        plan,
        reason: reason.trim() || '',
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
    } catch (err) {
      setError((err as Error).message)
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
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
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
          <Button type="submit" isLoading={isSubmitting}>
            Conceder cortesia
          </Button>
        </div>
      </form>
    </Modal>
  )
}
