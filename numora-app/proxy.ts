/**
 * proxy.ts
 * Guarda de autenticação — só protege /dashboard, sem NENHUM import de
 * módulo do projeto ou dependência externa (só `next/server`).
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
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE_PREFIX = 'sb-iebttmvrjgwtvibuauxr-auth-token'

export function proxy(request: NextRequest) {
  const isLoggedIn = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith(AUTH_COOKIE_PREFIX))

  if (!isLoggedIn && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
