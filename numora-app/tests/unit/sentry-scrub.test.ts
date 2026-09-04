import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/nextjs'

import { scrubErrorEvent } from '@/lib/monitoring/sentry-before-send'

function makeEvent(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { ...overrides } as ErrorEvent
}

describe('scrubErrorEvent', () => {
  it('remove cookies do request por completo (nunca mascarado parcialmente)', () => {
    const event = makeEvent({ request: { cookies: { 'sb-x-auth-token': 'real-session-value' } } })
    const result = scrubErrorEvent(event)
    expect(result.request?.cookies).toBeUndefined()
  })

  it('redige chaves sensíveis (password/token/secret/authorization) em request.headers', () => {
    const event = makeEvent({
      request: {
        headers: {
          Authorization: 'Bearer super-secret-token',
          'X-Password': 'hunter2',
          'Content-Type': 'application/json',
        },
      },
    })
    const result = scrubErrorEvent(event)
    expect(result.request?.headers?.Authorization).toBe('[REDACTED]')
    expect(result.request?.headers?.['X-Password']).toBe('[REDACTED]')
    // Chave não sensível permanece intacta — o scrub não é "apagar tudo".
    expect(result.request?.headers?.['Content-Type']).toBe('application/json')
  })

  /**
   * PROBLEMA ENCONTRADO por este teste (documentado, não corrigido nesta
   * etapa — só testes, sem mudança de comportamento funcional): o padrão
   * `SENSITIVE_KEY_PATTERN` casa a substring literal `service_role` (com
   * underscore), mas NÃO casa a convenção comum de nome de header HTTP
   * `Service-Role` (com hífen). Uma chave de corpo JSON como
   * `service_role_key` é redigida corretamente (testado abaixo); um header
   * hipotético `X-Service-Role` NÃO seria. Risco residual baixo (nenhum
   * caminho real do código hoje usa esse nome de header — auditoria da
   * Etapa "Sentry + tratamento global de erros" não encontrou nenhum), mas
   * vale registrar no relatório desta etapa como um achado, não silenciar.
   */
  it('redige "service_role" (underscore) em corpo JSON, mas o padrão NÃO cobre a variante com hífen em nome de header (achado documentado)', () => {
    const event = makeEvent({
      request: {
        data: { service_role_key: 'super-secret' },
        headers: { 'X-Service-Role': 'super-secret' },
      },
    })
    const result = scrubErrorEvent(event)
    const data = result.request?.data as Record<string, unknown>
    expect(data.service_role_key).toBe('[REDACTED]')
    // Comportamento real hoje (gap, não corrigido nesta etapa): passa direto.
    expect(result.request?.headers?.['X-Service-Role']).toBe('super-secret')
  })

  it('redige chaves sensíveis recursivamente dentro de request.data (objeto aninhado)', () => {
    const event = makeEvent({
      request: {
        data: {
          email: 'user@example.com',
          credentials: { token: 'raw-jwt-value', senha: '1234' },
        },
      },
    })
    const result = scrubErrorEvent(event)
    const data = result.request?.data as Record<string, unknown>
    expect(data.email).toBe('user@example.com')
    const credentials = data.credentials as Record<string, unknown>
    expect(credentials.token).toBe('[REDACTED]')
    expect(credentials.senha).toBe('[REDACTED]')
  })

  it('redige chaves sensíveis dentro de arrays em extra/contexts', () => {
    const event = makeEvent({
      extra: { attempts: [{ authorization: 'Bearer abc' }, { authorization: 'Bearer def' }] },
    })
    const result = scrubErrorEvent(event)
    const attempts = (result.extra?.attempts as Record<string, unknown>[]) ?? []
    expect(attempts[0].authorization).toBe('[REDACTED]')
    expect(attempts[1].authorization).toBe('[REDACTED]')
  })

  it('nunca lança quando request/extra/contexts estão ausentes — devolve o evento como veio', () => {
    const event = makeEvent({ message: 'algo quebrou' })
    expect(() => scrubErrorEvent(event)).not.toThrow()
    expect(scrubErrorEvent(event).message).toBe('algo quebrou')
  })

  it('é case-insensitive no nome da chave (Password/PASSWORD/password)', () => {
    const event = makeEvent({ extra: { Password: 'a', PASSWORD: 'b', password: 'c', normalField: 'd' } })
    const result = scrubErrorEvent(event)
    expect(result.extra?.Password).toBe('[REDACTED]')
    expect(result.extra?.PASSWORD).toBe('[REDACTED]')
    expect(result.extra?.password).toBe('[REDACTED]')
    expect(result.extra?.normalField).toBe('d')
  })
})
