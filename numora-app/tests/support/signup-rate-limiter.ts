/**
 * tests/support/signup-rate-limiter.ts
 * Etapa "B2.5.4" — portas de rate limit para os testes do handler de signup:
 * `allowAllRateLimiter` mantém inalterados os testes que não tratam do limite;
 * `createInMemoryRateLimiter` reproduz a semântica de janela fixa da RPC
 * `consume_signup_rate_limit` (a prova de atomicidade real está em
 * tests/integration/signup-rate-limit.test.ts, contra o DEV).
 */
import type { RateLimitDecision, SignupRateLimiterPort } from '@/lib/auth/signup-rate-limit'

export const allowAllRateLimiter: SignupRateLimiterPort = {
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}

export function createInMemoryRateLimiter(now: () => number = Date.now) {
  const buckets = new Map<string, { windowStart: number; hits: number }>()
  const calls: Array<{ bucketKey: string; limit: number; windowSeconds: number }> = []

  const port: SignupRateLimiterPort = {
    async consume(input): Promise<RateLimitDecision> {
      calls.push(input)
      const t = now()
      const windowMs = input.windowSeconds * 1000
      const current = buckets.get(input.bucketKey)
      const expired = !current || current.windowStart + windowMs <= t
      const entry = expired ? { windowStart: t, hits: 1 } : { windowStart: current.windowStart, hits: Math.min(current.hits + 1, input.limit + 1) }
      buckets.set(input.bucketKey, entry)

      if (entry.hits <= input.limit) return { allowed: true, retryAfterSeconds: 0 }
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - t) / 1000)) }
    },
  }

  return { port, calls, buckets }
}
