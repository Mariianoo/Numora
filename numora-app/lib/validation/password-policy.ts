/**
 * lib/validation/password-policy.ts
 * Etapa "Política de senha forte" — fonte única de verdade sobre o que
 * torna uma senha NOVA aceitável (cadastro e redefinição/troca de senha).
 *
 * Deliberadamente NUNCA usado no fluxo de login: uma senha já existente
 * não precisa (e não deve) ser reavaliada contra esta política — só
 * validamos a senha fornecida está correta, via
 * `authRepository.signInWithPassword()`. Reforçar isso aqui evita que
 * alguém, no futuro, importe este módulo por engano numa tela de login.
 */

export const MIN_PASSWORD_LENGTH = 8

export interface PasswordRequirement {
  id: string
  label: string
  test: (password: string) => boolean
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    id: 'length',
    label: `Pelo menos ${MIN_PASSWORD_LENGTH} caracteres`,
    test: (password) => password.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: 'uppercase',
    label: 'Uma letra maiúscula',
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    label: 'Uma letra minúscula',
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: 'number',
    label: 'Um número',
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: 'symbol',
    label: 'Um símbolo (ex.: @ # $ %)',
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
]

/** Único ponto de decisão sobre "esta senha nova é forte o suficiente?". */
export function isPasswordStrong(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(password))
}
