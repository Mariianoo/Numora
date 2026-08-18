/**
 * lib/analytics/attribution.ts
 * Etapa 15.10.2 — captura de first-touch attribution no navegador. Só
 * escreve o cookie (nunca o banco diretamente — isso é
 * `features/auth/repositories/auth.repository.ts`/`app/auth/callback/
 * route.ts`, no momento em que a conta é confirmada de verdade).
 *
 * Gate de consentimento: `marketing`, não `analytics` — atribuição
 * comercial (de onde veio o cadastro) é uma categoria diferente de
 * analytics comportamental do GTM/GA4 (Etapa 15.10.1), pedido explícito
 * desta etapa ("atribuição... deve continuar separada de dados
 * pessoais... e não deve depender de dados enviados ao Google"). Quem
 * decide QUANDO chamar `captureAttribution()` é `AttributionCapture.tsx`
 * (reage a `useConsent().marketing`), não este arquivo.
 *
 * First-touch nunca sobrescrita: `captureAttribution()` primeiro checa se
 * o cookie já existe — se sim, não faz nada. A garantia FORTE (contra
 * corrida/2ª aba/retry) continua sendo o `UNIQUE (user_id)` no banco
 * (migration `create_user_acquisition`); este check aqui só evita
 * reescrever o cookie com uma visita mais recente antes mesmo do
 * cadastro acontecer.
 *
 * Sem consentimento de marketing: `captureAttribution()` nunca é chamada
 * (ver AttributionCapture.tsx) — nenhum cookie é escrito, nenhum dado de
 * navegação é retido. Se o usuário se cadastrar sem nunca ter concedido
 * consentimento, `getStoredAttribution()` retorna `null` e nenhuma linha
 * é gravada em `user_acquisition` — comportamento correto (privacy by
 * default), não uma falha a contornar.
 */
'use client'

export interface StoredAttribution {
  source: string | null
  medium: string | null
  campaign: string | null
  term: string | null
  content: string | null
  landingPath: string
  /** Só o hostname do referrer (nunca a URL completa — pode ter querystring de terceiros). */
  referrer: string | null
  capturedAt: string
}

const COOKIE_NAME = 'numora_attribution'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 dias — janela padrão de atribuição de mercado

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function refererHostname(referrer: string): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname
  } catch {
    return null
  }
}

/** `null` quando nunca foi capturado (sem consentimento ainda, ou cookie expirado/limpo). */
export function getStoredAttribution(): StoredAttribution | null {
  const raw = readCookie(COOKIE_NAME)
  if (!raw) return null

  try {
    return JSON.parse(raw) as StoredAttribution
  } catch {
    return null
  }
}

/**
 * Grava o cookie de first-touch — só se ainda não existir. Sempre captura
 * `landingPath`/`referrer`/`capturedAt` mesmo sem nenhum parâmetro `utm_*`
 * (visita direta/orgânica é, em si, um dado de atribuição válido — ver
 * Caso D/H da matriz de testes desta etapa).
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return
  if (getStoredAttribution() !== null) return

  const params = new URLSearchParams(window.location.search)

  const attribution: StoredAttribution = {
    source: params.get('utm_source'),
    medium: params.get('utm_medium'),
    campaign: params.get('utm_campaign'),
    term: params.get('utm_term'),
    content: params.get('utm_content'),
    landingPath: window.location.pathname,
    referrer: refererHostname(document.referrer),
    capturedAt: new Date().toISOString(),
  }

  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(attribution))}; max-age=${MAX_AGE_SECONDS}; path=/; SameSite=Lax; Secure`
}

/** Chamado depois que a atribuição já foi persistida no banco (signup confirmado) — evita reenvio/dado obsoleto no navegador. */
export function clearStoredAttribution(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax; Secure`
}
