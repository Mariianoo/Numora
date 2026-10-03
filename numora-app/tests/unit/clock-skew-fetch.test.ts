/**
 * tests/unit/clock-skew-fetch.test.ts — Etapa "B2.5.4" (correção F1). O retry do teste de integração
 * vale SOMENTE para a assinatura exata do clock-skew do DEV (401 + PGRST303 "JWT issued at future"),
 * com número de tentativas finito; qualquer outro erro é propagado de imediato, sem nova tentativa.
 */
import { describe, expect, it, vi } from 'vitest'

import { createClockSkewRetryingFetch, isClockSkewBody } from '../support/clock-skew-fetch'

const SKEW = { code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(responses: Array<Response | Error>, options: { maxAttempts?: number } = {}) {
  let call = 0
  const base = vi.fn(async () => {
    const next = responses[Math.min(call, responses.length - 1)]
    call += 1
    if (next instanceof Error) throw next
    return next.clone()
  })
  return { base, fetch: createClockSkewRetryingFetch(base as unknown as typeof fetch, { delayMs: 1, ...options }) }
}

describe('isClockSkewBody — assinatura exata', () => {
  it('só code PGRST303 + mensagem "JWT issued at future"', () => {
    expect(isClockSkewBody(SKEW)).toBe(true)
    expect(isClockSkewBody({ code: 'PGRST303', message: 'jwt issued at future (iat=1)' })).toBe(true)
  })

  it.each([
    [{ code: 'PGRST303', message: 'JWT expired' }],
    [{ code: 'PGRST301', message: 'JWT issued at future' }],
    [{ code: 'PGRST303' }],
    [{ message: 'JWT issued at future' }],
    [{ code: 42, message: 'JWT issued at future' }],
    ['PGRST303 JWT issued at future'],
    [null],
    [undefined],
  ])('%j → não é clock-skew', (body) => {
    expect(isClockSkewBody(body)).toBe(false)
  })
})

describe('createClockSkewRetryingFetch', () => {
  it('clock-skew conhecido → repete e devolve a resposta boa', async () => {
    const ok = json(200, [{ allowed: true }])
    const { base, fetch } = setup([json(401, SKEW), ok])
    const response = await fetch('http://x/rpc', { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('o número de tentativas é FINITO: clock-skew persistente para em maxAttempts (3) e devolve a última resposta', async () => {
    const { base, fetch } = setup([json(401, SKEW)])
    const response = await fetch('http://x/rpc', { method: 'POST', body: '{}' })
    expect(response.status).toBe(401)
    expect(base).toHaveBeenCalledTimes(3)
  })

  it('respeita um maxAttempts menor', async () => {
    const { base, fetch } = setup([json(401, SKEW)], { maxAttempts: 1 })
    await fetch('http://x/rpc', { method: 'POST', body: '{}' })
    expect(base).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['401 com outro código (JWT inválido)', json(401, { code: 'PGRST301', message: 'JWT invalid' })],
    ['401 PGRST303 com outra mensagem (expirado)', json(401, { code: 'PGRST303', message: 'JWT expired' })],
    ['401 sem JSON', new Response('Unauthorized', { status: 401 })],
    ['403 permission denied', json(403, { code: '42501', message: 'permission denied for function consume_signup_rate_limit' })],
    ['400 erro de constraint', json(400, { code: '23514', message: 'violates check constraint' })],
    ['400 parâmetro inválido da RPC', json(400, { code: '22023', message: 'limite inválido' })],
    ['404 RPC inexistente', json(404, { code: 'PGRST202', message: 'Could not find the function' })],
    ['408 timeout', json(408, { code: 'PGRST000', message: 'timeout' })],
    ['500 erro do banco', json(500, { code: 'XX000', message: 'internal error' })],
    ['503 indisponível', json(503, { message: 'service unavailable' })],
    ['200 resposta válida', json(200, [{ allowed: false, retry_after_seconds: 30 }])],
    ['200 com corpo inválido para a RPC', json(200, { qualquer: 'coisa' })],
  ])('NÃO repete: %s → uma única chamada, resposta devolvida intacta', async (_label, response) => {
    const { base, fetch } = setup([response])
    const result = await fetch('http://x/rpc', { method: 'POST', body: '{}' })
    expect(base).toHaveBeenCalledTimes(1)
    expect(result.status).toBe(response.status)
  })

  it('erro de rede/timeout do fetch é propagado de imediato, sem nova tentativa', async () => {
    const failure = new TypeError('fetch failed')
    const { base, fetch } = setup([failure])
    await expect(fetch('http://x/rpc', { method: 'POST', body: '{}' })).rejects.toBe(failure)
    expect(base).toHaveBeenCalledTimes(1)

    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const second = setup([timeout])
    await expect(second.fetch('http://x/rpc', { method: 'POST', body: '{}' })).rejects.toBe(timeout)
    expect(second.base).toHaveBeenCalledTimes(1)
  })

  it('o clock-skew seguido de um erro de negócio: repete uma vez e então propaga o erro de negócio (sem mais repetições)', async () => {
    const business = json(400, { code: '22023', message: 'limite inválido' })
    const { base, fetch } = setup([json(401, SKEW), business])
    const result = await fetch('http://x/rpc', { method: 'POST', body: '{}' })
    expect(result.status).toBe(400)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('corpo que não é texto não pode ser reenviado: devolve a resposta sem repetir', async () => {
    const { base, fetch } = setup([json(401, SKEW)])
    await fetch('http://x/rpc', { method: 'POST', body: new Uint8Array([1, 2, 3]) })
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('reenvia exatamente os mesmos argumentos', async () => {
    const { base, fetch } = setup([json(401, SKEW), json(200, [])])
    const init = { method: 'POST', body: '{"p_bucket":"x"}', headers: { apikey: 'k' } }
    await fetch('http://x/rpc', init)
    expect(base.mock.calls[0]).toEqual(base.mock.calls[1])
    expect(base.mock.calls[1]).toEqual(['http://x/rpc', init])
  })
})
