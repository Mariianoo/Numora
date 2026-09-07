/**
 * lib/supabase/assert-dev-project.ts
 * Etapa "Stripe 4.1A" — guard de aplicação (não de teste) para garantir que
 * qualquer rotina privilegiada que só deve rodar contra DEV (a futura
 * sincronização de preços do Stripe, Stripe 4.1B) nunca execute
 * acidentalmente contra Production.
 *
 * Reaproveita a mesma identificação de projeto já usada pelos testes
 * (`lib/supabase/project-ref.ts`, extraído de `tests/support/dev-env.ts`)
 * — nenhuma segunda cópia da lógica de detecção de ref.
 *
 * Fail-closed por design: qualquer coisa que não seja EXATAMENTE o ref de
 * DEV lança erro — incluindo um ref desconhecido/não reconhecido (nunca
 * "assume que está tudo bem" quando o ref não pode ser determinado).
 */
import { DEV_PROJECT_REF, PRODUCTION_PROJECT_REF, extractProjectRef } from './project-ref'

/**
 * Lança se `supabaseUrl` não for exatamente o projeto DEV. Chamar antes de
 * qualquer operação privilegiada (leitura ou escrita) que só deve ser
 * possível contra DEV.
 */
export function assertDevProject(supabaseUrl: string): void {
  const ref = extractProjectRef(supabaseUrl)

  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `[assertDevProject] A URL do Supabase aponta para PRODUCTION (${PRODUCTION_PROJECT_REF}). ` +
        'Esta operação só pode rodar contra DEV — abortando.',
    )
  }

  if (ref !== DEV_PROJECT_REF) {
    throw new Error(
      `[assertDevProject] Não foi possível confirmar que a URL do Supabase é o projeto DEV ` +
        `(ref encontrado: "${ref ?? '<indeterminado>'}", esperado: "${DEV_PROJECT_REF}"). ` +
        'Falhando fechado — abortando.',
    )
  }
}
