/**
 * proxy.ts
 * Guarda de autenticação + Maintenance Mode — sem NENHUM import de módulo
 * do projeto ou dependência externa (só `next/server`).
 *
 * A partir do Next.js 16, o arquivo `middleware.ts` foi renomeado para
 * `proxy.ts` (ver https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
 * Diferença importante: Proxy roda em Node.js runtime por padrão (não mais
 * Edge Runtime). Antes, em `middleware.ts`, este arquivo importava
 * `@supabase/ssr` (que puxava `@/lib/env`, baseado em Zod) para validar a
 * sessão de verdade — isso quebrava o bundle da Edge Function
 * ("referencing unsupported modules"). Mantemos a checagem simples (só a
 * PRESENÇA do cookie de sessão que o Supabase Auth grava no browser,
 * `sb-<project-ref>-auth-token`, podendo vir em pedaços `.0`, `.1`...
 * quando o valor é grande) — não valida o token. A validação real continua
 * em app/dashboard/page.tsx via `supabase.auth.getUser()` — isto aqui é só
 * um atalho de UX para evitar renderizar a página protegida sem cookie
 * nenhum.
 *
 * O redirect "se já logado, sair de /login" foi removido daqui de
 * propósito: com checagem de presença (não de validade), um cookie
 * presente-mas-expirado causaria loop de redirect entre /login e
 * /dashboard (dashboard manda pra /login, proxy manda de volta pra
 * /dashboard). Esse comportamento já existe no client em
 * app/login/page.tsx, que valida a sessão de verdade via supabase-js
 * antes de redirecionar — sem risco de loop.
 *
 * Etapa 15.3 (Admin Control Center): `/admin` ganhou o mesmo atalho de UX
 * — só a presença do cookie. A autorização real (role owner/admin) nunca
 * poderia viver aqui (este arquivo não pode importar `@supabase/ssr`, ver
 * acima) — ela é validada em `app/admin/layout.tsx`
 * (`features/admin/access.ts`), no servidor, contra `profiles.role`.
 *
 * Etapa "5.10L-A — Maintenance Mode Core": kill-switch de manutenção,
 * avaliado ANTES da lógica de autenticação acima (uma rota bloqueada por
 * manutenção nunca deveria "vazar" para o fluxo normal de login/dashboard).
 * Especificação completa: relatório "5.10L — Maintenance Mode + Status
 * Page + Health Check". Decisões-chave:
 *
 *   - Só tem QUALQUER efeito quando `VERCEL_ENV === 'production'` — em
 *     Preview/Development, `MAINTENANCE_MODE` é sempre ignorado, mesmo se
 *     definido (evita bloquear um ambiente de teste por engano).
 *   - Allowlist EXPLÍCITA (nunca denylist): por padrão, toda rota nova
 *     criada no futuro fica bloqueada durante manutenção até ser
 *     adicionada deliberadamente à lista.
 *   - Bypass administrativo depende SOMENTE de `MAINTENANCE_BYPASS_TOKEN`
 *     — nunca de cookie de sessão, role, ou qualquer sinal do Supabase
 *     (este arquivo não pode importar `@supabase/ssr`, e mesmo se pudesse,
 *     um bypass baseado em sessão reabriria a superfície inteira do
 *     produto para qualquer usuário logado, não só admins).
 *   - O token pode ser enviado uma única vez via query string
 *     (`?maintenance_bypass=<token>`) para "iniciar" o bypass — a mesma
 *     resposta que valida o token já redireciona para a MESMA URL sem o
 *     parâmetro (nunca deixamos o navegador "descansar" numa URL que
 *     contém o segredo) e grava um cookie HttpOnly para as próximas
 *     requisições. Risco residual aceito e documentado no relatório da
 *     etapa: a URL de bootstrap com o token pode aparecer em logs de
 *     acesso do host (Vercel) e no histórico do navegador — mitigado por
 *     essa troca ser de uso único e pelo token ser rotacionável a
 *     qualquer momento via env var, sem depender de código.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// O prefixo do cookie de sessão embute o project ref do Supabase
// (`sb-<project-ref>-auth-token`) — hardcoded aqui até a Etapa 15.10.21E
// (só o ref de PRODUCTION), o que fazia este arquivo confundir "deslogado"
// com "logado num projeto Supabase diferente" (ex.: DEVELOPMENT, em
// ambiente local). Lido de `process.env.NEXT_PUBLIC_SUPABASE_URL`
// diretamente (sem importar `@/lib/env` nem qualquer módulo do projeto —
// continua valendo a regra do topo deste arquivo) para acompanhar
// automaticamente qual projeto está ativo em cada ambiente.
const SUPABASE_PROJECT_REF = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(
  /^https:\/\/([^.]+)\.supabase\.co/,
)?.[1]
const AUTH_COOKIE_PREFIX = `sb-${SUPABASE_PROJECT_REF}-auth-token`
const PROTECTED_PREFIXES = ['/dashboard', '/admin']

// Etapa 5.10L-A — nome do cookie de bypass de manutenção. Guarda o próprio
// valor de `MAINTENANCE_BYPASS_TOKEN` (nunca um hash/HMAC: este arquivo não
// pode importar nem mesmo `crypto` do Node por convenção — ver cabeçalho),
// mas é HttpOnly (inacessível a JS/HTML) e só é comparado, nunca lido de
// volta para decidir conteúdo — rotacionar a env var invalida todo cookie
// já emitido instantaneamente (a comparação abaixo simplesmente passa a
// falhar).
const MAINTENANCE_BYPASS_COOKIE = 'numora_maintenance_bypass'
const MAINTENANCE_BYPASS_QUERY_PARAM = 'maintenance_bypass'
const MAINTENANCE_BYPASS_MAX_AGE_SECONDS = 60 * 60 * 12 // 12h — só dura o suficiente para uma janela de manutenção, nunca "para sempre"

// Rotas sempre acessíveis durante manutenção, independente de bypass — ver
// seção 3 do relatório 5.10L. `/_next/*`/favicon/robots/manifest também já
// são excluídos no nível do `matcher` (abaixo) por extensão/prefixo — esta
// lista é defesa em profundidade, não a única barreira.
const MAINTENANCE_ALWAYS_ALLOWED_EXACT_PATHS = new Set(['/maintenance', '/status', '/api/health', '/favicon.ico', '/robots.txt', '/manifest.webmanifest'])

function isMaintenanceAllowedPath(pathname: string): boolean {
  if (MAINTENANCE_ALWAYS_ALLOWED_EXACT_PATHS.has(pathname)) return true
  // /status e /api/health ainda não existem nesta etapa (5.10L-B/C) — já
  // liberados agora para não exigir uma segunda mudança neste arquivo
  // quando forem implementados.
  if (pathname.startsWith('/api/health/')) return true
  // NUNCA bloquear o webhook do Stripe — Stripe pode desativar um endpoint
  // que falha repetidamente, e o 5.10F depende de webhooks tardios
  // continuarem sendo processados mesmo durante uma manutenção de billing.
  if (pathname === '/api/stripe/webhook' || pathname.startsWith('/api/stripe/webhook/')) return true
  if (pathname.startsWith('/_next/')) return true
  return false
}

/**
 * Comparação em tempo constante (best-effort): evita que um atacante meça
 * quantos caracteres iniciais acertou observando o tempo de resposta.
 * Implementada manualmente (sem `crypto.timingSafeEqual`) porque este
 * arquivo não importa nada além de `next/server` — ver cabeçalho.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * `null` = manutenção não bloqueia esta requisição (bypass válido, ou a
 * rota já está na allowlist). Um `NextResponse` não-nulo é a resposta
 * final desta requisição (redirect de bootstrap do bypass, ou redirect
 * para `/maintenance`).
 */
function evaluateMaintenanceMode(request: NextRequest): NextResponse | null {
  const isProductionEnvironment = process.env.VERCEL_ENV === 'production'
  if (!isProductionEnvironment || process.env.MAINTENANCE_MODE !== 'true') {
    return null
  }

  const bypassToken = process.env.MAINTENANCE_BYPASS_TOKEN
  const { pathname, searchParams } = request.nextUrl

  const bypassCookieValue = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value
  if (bypassToken && bypassCookieValue && safeCompare(bypassCookieValue, bypassToken)) {
    return null // bypass já concedido nesta sessão — trata como manutenção desligada
  }

  // Bootstrap do bypass: token correto na query string troca por um cookie
  // HttpOnly e imediatamente remove o token da URL (ver cabeçalho do
  // arquivo para o raciocínio de risco/mitigação).
  const queryToken = searchParams.get(MAINTENANCE_BYPASS_QUERY_PARAM)
  if (bypassToken && queryToken && safeCompare(queryToken, bypassToken)) {
    const redirectUrl = new URL(request.url)
    redirectUrl.searchParams.delete(MAINTENANCE_BYPASS_QUERY_PARAM)
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.set(MAINTENANCE_BYPASS_COOKIE, bypassToken, {
      httpOnly: true,
      secure: true, // este branch só roda com isProductionEnvironment === true (sempre HTTPS)
      sameSite: 'lax',
      path: '/',
      maxAge: MAINTENANCE_BYPASS_MAX_AGE_SECONDS,
    })
    return response
  }

  if (isMaintenanceAllowedPath(pathname)) {
    return null
  }

  return NextResponse.redirect(new URL('/maintenance', request.url))
}

export function proxy(request: NextRequest) {
  const maintenanceResponse = evaluateMaintenanceMode(request)
  if (maintenanceResponse) {
    return maintenanceResponse
  }

  const isLoggedIn = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith(AUTH_COOKIE_PREFIX))

  const isProtectedPath = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))

  if (!isLoggedIn && isProtectedPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

// Etapa 5.10L-A: o matcher precisou crescer de só `/dashboard`/`/admin` para
// (quase) todas as rotas — Maintenance Mode precisa interceptar páginas
// públicas e APIs também. A exclusão por extensão de arquivo (em vez de só
// nomear `_next/static`/`_next/image`) evita bloquear QUALQUER asset
// estático servido de `public/` (ex.: `/brand/numora-logo-dark.png`, usado
// pela própria página `/maintenance` — bloqueá-lo quebraria a página que
// deveria continuar funcionando). Quando `MAINTENANCE_MODE` está desligado
// (ou fora de Production), o comportamento observável é idêntico ao atual:
// `evaluateMaintenanceMode` retorna `null` de imediato e a lógica de
// autenticação abaixo roda exatamente como antes.
export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|gif|webp|svg|css|js|map|woff|woff2|ttf|txt|webmanifest)$).*)'],
}
