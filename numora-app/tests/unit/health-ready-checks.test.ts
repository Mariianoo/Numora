/**
 * tests/unit/health-ready-checks.test.ts
 * Etapa "5.10L-B — Health Check" — cobre `lib/health/ready-checks.ts`
 * isoladamente (nenhuma rede real, nenhum Supabase real). `checkDatabase`
 * recebe um client Supabase FALSO com a mesma cadeia fluente usada pelo
 * código real (`from().select().abortSignal().throwOnError()`); `checkStorage`
 * stuba `global.fetch`; `checkConfiguration` stuba `process.env`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

import { checkConfiguration, checkDatabase, checkStorage } from '@/lib/health/ready-checks'

function makeSupabaseMock(finalStep: () => Promise<unknown>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        abortSignal: () => ({
          throwOnError: () => finalStep(),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('checkDatabase', () => {
  it('resposta normal do PostgREST (sem erro) → ok', async () => {
    const supabase = makeSupabaseMock(() => Promise.resolve({ data: null, error: null, count: 0 }))
    await expect(checkDatabase(supabase)).resolves.toBe('ok')
  })

  it('42501 permission denied (esperado neste projeto — anon sem grant) tratado como componente vivo → ok', async () => {
    const permissionDenied = new PostgrestError({ message: 'permission denied for table plans', details: '', hint: '', code: '42501' })
    const supabase = makeSupabaseMock(() => Promise.reject(permissionDenied))
    await expect(checkDatabase(supabase)).resolves.toBe('ok')
  })

  it('timeout (AbortError, nunca vira PostgrestError) → fail', async () => {
    const abortError = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    const supabase = makeSupabaseMock(() => Promise.reject(abortError))
    await expect(checkDatabase(supabase)).resolves.toBe('fail')
  })

  it('erro de transporte/rede (TypeError, nunca vira PostgrestError) → fail', async () => {
    const supabase = makeSupabaseMock(() => Promise.reject(new TypeError('fetch failed')))
    await expect(checkDatabase(supabase)).resolves.toBe('fail')
  })
})

describe('checkStorage', () => {
  it('HTTP 200 de /storage/v1/status → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    await expect(checkStorage('https://project.supabase.co')).resolves.toBe('ok')
  })

  it('HTTP não-200 → fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(checkStorage('https://project.supabase.co')).resolves.toBe('fail')
  })

  it('timeout/erro de rede (fetch rejeita) → fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    await expect(checkStorage('https://project.supabase.co')).resolves.toBe('fail')
  })

  it('nunca lê o corpo da resposta do Storage', async () => {
    const textSpy = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: textSpy, json: textSpy }))
    await checkStorage('https://project.supabase.co')
    expect(textSpy).not.toHaveBeenCalled()
  })
})

describe('checkConfiguration', () => {
  it('ambas as variáveis presentes → ok', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-value')
    expect(checkConfiguration()).toBe('ok')
  })

  it('NEXT_PUBLIC_SUPABASE_URL ausente → fail', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-value')
    expect(checkConfiguration()).toBe('fail')
  })

  it('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente → fail', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect(checkConfiguration()).toBe('fail')
  })
})
