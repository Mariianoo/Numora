/**
 * components/ui/PasswordRequirementsList.tsx
 * Etapa "Política de senha forte" — checklist visual dos requisitos de
 * senha, reagindo em tempo real ao valor digitado. Única fonte de
 * requisitos é `PASSWORD_REQUIREMENTS` (lib/validation/password-policy.ts)
 * — nunca duplica a regra aqui, só formata o resultado de `req.test()`.
 */
import { Check, Circle } from 'lucide-react'

import { PASSWORD_REQUIREMENTS } from '@/lib/validation/password-policy'
import { cn } from './utils'

export function PasswordRequirementsList({ password }: { password: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const met = requirement.test(password)
        return (
          <li
            key={requirement.id}
            className={cn('flex items-center gap-1.5 text-xs', met ? 'text-success' : 'text-text-secondary')}
          >
            {met ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <Circle className="size-3.5 shrink-0" aria-hidden />
            )}
            {requirement.label}
          </li>
        )
      })}
    </ul>
  )
}
