/**
 * lib/auth/signup-rate-limit.ts
 * Etapa "B2.5.4 — Rate limiting do signup" — política e helpers do limite de
 * tentativas de POST /api/auth/signup. SÓ servidor.
 *
 * O contador vive no Postgres (RPC `consume_signup_rate_limit`, atômica), nunca
 * em memória do processo: cada instância serverless enxerga o mesmo estado.
 *
 * Duas dimensões, ambas armazenadas como HASH (IP e e-mail nunca vão em claro
 * ao banco):
 *  - IP: estoura → HTTP 429 + Retry-After (antes do Turnstile e da criação);
 *  - e-mail normalizado: estoura → resposta NEUTRA de sucesso, sem efeito
 *    (mesma do cooldown de reemissão) — não revela que o endereço foi tentado.
 *
 * PSEUDONIMIZAÇÃO, não anonimização: o hash é SHA-256 sem pepper e o espaço de
 * IPv4 e de e-mails conhecidos é enumerável, então quem lê a tabela consegue
 * confirmar se um IP/e-mail específico está lá. Trate a chave do bucket como
 * DADO PSEUDONIMIZADO (dado pessoal), nunca como dado anônimo.
 *
 * Falha do limiter (banco indisponível, resposta malformada ou tempo esgotado)
 * → o handler responde 503 e NADA é criado (fail-closed).
 */
import { createHash } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'

export const SIGNUP_RATE_LIMITS = {
  ip: { limit: 10, windowSeconds: 15 * 60 },
  email: { limit: 3, windowSeconds: 60 * 60 },
} as const

/**
 * Tempo máximo de CADA chamada ao contador (a RPC é um único upsert indexado,
 * normalmente de poucos ms). 2,5 s é o mesmo orçamento que `lib/health/ready-checks.ts`
 * já usa para uma consulta simples ao mesmo banco; as duas chamadas do signup
 * (IP e e-mail) somam no máximo 5 s, o mesmo teto do Turnstile em
 * `lib/captcha/turnstile-server.ts`.
 */
export const SIGNUP_RATE_LIMIT_TIMEOUT_MS = 2500

export interface RateLimitDecision {
  allowed: boolean
  /** Segundos até a janela reabrir; 0 quando `allowed`. */
  retryAfterSeconds: number
}

/** Porta do contador — implementada em lib/auth/signup-adapters.ts; LANÇA se o backend falhar ou exceder o timeout. */
export interface SignupRateLimiterPort {
  consume(input: { bucketKey: string; limit: number; windowSeconds: number }): Promise<RateLimitDecision>
}

const UNKNOWN_IP = 'unknown'

function expandIpv6(address: string): string[] | null {
  let addr = address.toLowerCase()
  const embeddedV4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (embeddedV4) {
    const [a, b, c, d] = embeddedV4[1].split('.').map(Number)
    addr = `${addr.slice(0, -embeddedV4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const halves = addr.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null

  const groups = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill('0'), ...tail]
  return groups.length === 8 ? groups.map((g) => g.replace(/^0+(?=.)/, '')) : null
}

/**
 * IPv4 → o próprio endereço; IPv6 → o prefixo /64 (um assinante inteiro: girar
 * o sufixo não escapa do limite); IPv4 mapeado em IPv6 → o IPv4. Qualquer outra
 * coisa → `null`.
 */
export function normalizeClientIp(raw: string): string | null {
  const first = raw.split(',')[0]?.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '') ?? ''
  if (first === '') return null
  if (isIPv4(first)) return first

  if (!isIPv6(first)) return null
  const mapped = first.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped && isIPv4(mapped[1])) return mapped[1]

  const groups = expandIpv6(first)
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : null
}

/**
 * IP do cliente a partir de `x-vercel-forwarded-for`. A Vercel SOBRESCREVE esse
 * header em toda requisição que chega à borda (o valor do cliente nunca é
 * repassado), então ele é confiável — mas só dentro da Vercel. Fora dela
 * (`VERCEL !== '1'`: dev local, testes, self-host) nenhum header é confiável e
 * o resultado é `null` → bucket único "unknown", o mais restritivo. Atrás de um
 * proxy próprio (ex.: Cloudflare na frente da Vercel) esse header traz o IP do
 * proxy: a premissa deve ser revista antes de pôr um proxy na frente.
 */
export function getTrustedClientIp(headers: Headers, env: Record<string, string | undefined>): string | null {
  if (env.VERCEL !== '1') return null
  const raw = headers.get('x-vercel-forwarded-for')
  return raw ? normalizeClientIp(raw) : null
}

/** Minúsculas, NFKC e sem `+tag`: as variações do mesmo endereço caem no mesmo bucket. */
export function normalizeEmailForRateLimit(email: string): string {
  const lowered = email.normalize('NFKC').trim().toLowerCase()
  const at = lowered.lastIndexOf('@')
  if (at < 1) return lowered
  const local = lowered.slice(0, at).split('+')[0]
  return local === '' ? lowered : `${local}@${lowered.slice(at + 1)}`
}

/** Chave do bucket — SHA-256 com separação de domínio, sem pepper: valor em claro nunca é gravado, mas o hash é dado PSEUDONIMIZADO (ver o cabeçalho). */
export function rateLimitBucketKey(kind: 'ip' | 'email', value: string): string {
  return `${kind}:${createHash('sha256').update(`numora.signup-rate-limit.v1|${kind}|${value}`).digest('hex')}`
}

export function consumeSignupIpLimit(port: SignupRateLimiterPort, ip: string | null): Promise<RateLimitDecision> {
  return port.consume({ bucketKey: rateLimitBucketKey('ip', ip ?? UNKNOWN_IP), ...SIGNUP_RATE_LIMITS.ip })
}

export function consumeSignupEmailLimit(port: SignupRateLimiterPort, email: string): Promise<RateLimitDecision> {
  return port.consume({ bucketKey: rateLimitBucketKey('email', normalizeEmailForRateLimit(email)), ...SIGNUP_RATE_LIMITS.email })
}
