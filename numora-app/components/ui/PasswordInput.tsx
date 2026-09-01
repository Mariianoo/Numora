/**
 * components/ui/PasswordInput.tsx
 * Etapa "Política de senha forte" — campo de senha com botão de
 * mostrar/ocultar, reaproveitando `Input` (via `rightElement`) e
 * `IconButton`, mesmo padrão de ícone (`Eye`/`EyeOff`) já usado em
 * app/dashboard/collection/page.tsx para o toggle de valor de aquisição.
 *
 * O toggle só alterna o atributo `type` do `<input>` (`password` ↔
 * `text`) — nunca lê nem escreve `value`, então o valor digitado nunca é
 * perdido ou alterado ao clicar no olho.
 */
'use client'

import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Input, type InputProps } from './Input'
import { IconButton } from './IconButton'

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'rightElement'>>(
  function PasswordInput(props, ref) {
    const [isVisible, setIsVisible] = useState(false)

    return (
      <Input
        ref={ref}
        type={isVisible ? 'text' : 'password'}
        rightElement={
          <IconButton
            type="button"
            icon={isVisible ? EyeOff : Eye}
            size="sm"
            onClick={() => setIsVisible((current) => !current)}
            aria-label={isVisible ? 'Ocultar senha' : 'Mostrar senha'}
          />
        }
        {...props}
      />
    )
  },
)
