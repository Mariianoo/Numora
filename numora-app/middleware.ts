/**
 * middleware.ts
 * Guarda de autenticação (App Router): protege /dashboard e evita que um
 * usuário já logado acesse /login. Lê a sessão via cookies do request.
 *
 * `middleware.ts` roda sempre no Edge Runtime da Vercel, não importa a
 * config do resto do app — por isso não importa `@/lib/env` (Zod), que
 * quebra o bundle de Edge Function ("referencing unsupported modules").
 * Aqui o acesso é direto a `process.env.<NOME_ESTÁTICO>`, que o Next
 * consegue inlinar em build/edge; qualquer outro lugar (client/server
 * components, route handlers) continua usando `@/lib/env` normalmente.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export async function middleware(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      '[middleware] NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes.',
    )
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // `getUser()` revalida o token com o servidor Auth — ao contrário de
  // `getSession()`, não confia cegamente no cookie lido do request.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
}
