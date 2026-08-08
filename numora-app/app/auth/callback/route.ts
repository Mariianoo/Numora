/**
 * app/auth/callback/route.ts
 * Route Handler de retorno do OAuth (Google). Troca o `code` recebido do
 * provedor por uma sessão Supabase, gravando os cookies via
 * lib/supabase/server.ts, e redireciona para o dashboard.
 *
 * A criação da linha em `profiles` é automática (trigger
 * `on_auth_user_created` em `auth.users`, ver supabase/migrations) — não
 * depende deste código. Aqui só atualizamos email/nome a cada login, caso
 * tenham mudado no provedor.
 */
import { NextResponse } from 'next/server'

import { getSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const user = data.user
      await supabase
        .from('profiles')
        .update({
          email: user.email,
          name: (user.user_metadata?.name ?? user.user_metadata?.full_name ?? null) as string | null,
        })
        .eq('id', user.id)

      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
