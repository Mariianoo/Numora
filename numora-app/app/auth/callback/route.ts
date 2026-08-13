/**
 * app/auth/callback/route.ts
 * Route Handler de retorno do fluxo de Auth. Troca o `code` recebido por
 * uma sessão Supabase, gravando os cookies via lib/supabase/server.ts, e
 * redireciona para o dashboard.
 *
 * Usado por dois fluxos (Etapa 7):
 * - confirmação de e-mail após cadastro por e-mail/senha — "Confirm
 *   email" está habilitado neste projeto (confirmado empiricamente antes
 *   desta etapa), então todo cadastro passa por aqui na primeira vez;
 * - OAuth (Google) — mantido sem uso na UI, mas preservado; se reativado
 *   no futuro, volta a usar este mesmo callback sem alteração.
 *
 * A criação da linha em `profiles` é automática (trigger
 * `on_auth_user_created` em `auth.users`, ver supabase/migrations) — não
 * depende deste código. Aqui atualizamos email/nome a cada confirmação/
 * login, caso tenham mudado, e `country_code` quando veio do formulário
 * de cadastro (`user_metadata.country_code` — o trigger só lê name/email,
 * nunca país). Nota: este UPDATE roda em toda passagem por aqui, não só
 * na primeira — se um dia existir tela de editar país, este trecho
 * precisa parar de sobrescrever incondicionalmente.
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
      const countryCode = (user.user_metadata?.country_code ?? null) as string | null

      await supabase
        .from('profiles')
        .update({
          email: user.email,
          name: (user.user_metadata?.name ?? user.user_metadata?.full_name ?? null) as string | null,
          ...(countryCode ? { country_code: countryCode } : {}),
        })
        .eq('id', user.id)

      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
