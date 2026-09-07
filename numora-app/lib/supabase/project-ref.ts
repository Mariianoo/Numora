/**
 * lib/supabase/project-ref.ts
 * Etapa "Stripe 4.1A" — identificação do projeto Supabase por ref extraído
 * da URL. Extraído de `tests/support/dev-env.ts` (que já usava exatamente
 * esta lógica só para testes) para virar a única fonte, reutilizável tanto
 * por testes quanto por qualquer futura rotina de aplicação/servidor que
 * precise da mesma garantia (ex.: a futura sincronização de preços do
 * Stripe, Stripe 4.1B) — nunca duas cópias da mesma checagem de segurança.
 *
 * Refs são públicos (aparecem na própria URL do projeto, ex.:
 * `https://sfhnhgkicvtvhbwpttwh.supabase.co`) — não são secret, só
 * identificam qual projeto é qual.
 */
export const DEV_PROJECT_REF = 'sfhnhgkicvtvhbwpttwh' // numora-development
export const PRODUCTION_PROJECT_REF = 'iebttmvrjgwtvibuauxr' // numora

/** `null` quando a URL não tem o formato esperado de projeto Supabase. */
export function extractProjectRef(url: string): string | null {
  return url.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? null
}
