/**
 * tests/unit/supabase-assert-dev-project.test.ts
 * Etapa "Stripe 4.1A" — `assertDevProject` (lib/supabase/assert-dev-project.ts).
 * Nenhuma chamada de rede — só confere o ref extraído da URL.
 */
import { describe, expect, it } from 'vitest'

import { assertDevProject } from '@/lib/supabase/assert-dev-project'

describe('assertDevProject', () => {
  it('aceita o projeto DEV', () => {
    expect(() => assertDevProject('https://sfhnhgkicvtvhbwpttwh.supabase.co')).not.toThrow()
  })

  it('rejeita explicitamente o projeto Production', () => {
    expect(() => assertDevProject('https://iebttmvrjgwtvibuauxr.supabase.co')).toThrow(/PRODUCTION/)
  })

  it('falha fechado para um ref desconhecido (nunca assume que está tudo bem)', () => {
    expect(() => assertDevProject('https://algum-outro-projeto.supabase.co')).toThrow(/indeterminado|esperado/)
  })

  it('falha fechado para uma URL sem o formato esperado de projeto Supabase', () => {
    expect(() => assertDevProject('https://example.com')).toThrow()
  })
})
