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
 *
 * Etapa 15.10.2: este é o ponto real (não o client) onde a maioria dos
 * cadastros persiste a atribuição de first-touch — "Confirm email"
 * habilitado significa que `signUp()` (client) quase nunca tem sessão
 * imediata, então o cookie `numora_attribution` (se existir — só existe
 * quando o visitante concedeu `consent.marketing` antes do cadastro)
 * chega até aqui, gravado pelo próprio navegador na requisição GET (não é
 * httpOnly, mas isso não importa aqui: lemos via `cookies()` do lado do
 * servidor de qualquer forma). `upsert(..., ignoreDuplicates: true)`
 * nunca sobrescreve — mesma garantia usada em
 * features/auth/repositories/auth.repository.ts. Falha aqui nunca
 * bloqueia o login (try/catch silencioso) — atribuição é enriquecimento,
 * não caminho crítico de autenticação.
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { getSupabaseServerClient } from '@/lib/supabase/server'

const ATTRIBUTION_COOKIE = 'numora_attribution'

interface StoredAttribution {
  source: string | null
  medium: string | null
  campaign: string | null
  term: string | null
  content: string | null
  landingPath: string
  referrer: string | null
  capturedAt: string
}

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

      const cookieStore = await cookies()
      const attributionCookie = cookieStore.get(ATTRIBUTION_COOKIE)?.value
      let attributionPersisted = false

      if (attributionCookie) {
        try {
          const attribution = JSON.parse(decodeURIComponent(attributionCookie)) as StoredAttribution

          const { error: attributionError } = await supabase.from('user_acquisition').upsert(
            {
              user_id: user.id,
              first_source: attribution.source ?? null,
              first_medium: attribution.medium ?? null,
              first_campaign: attribution.campaign ?? null,
              first_term: attribution.term ?? null,
              first_content: attribution.content ?? null,
              landing_path: attribution.landingPath ?? null,
              referrer: attribution.referrer ?? null,
              captured_at: attribution.capturedAt ?? new Date().toISOString(),
            },
            { onConflict: 'user_id', ignoreDuplicates: true },
          )

          attributionPersisted = !attributionError
        } catch {
          // JSON inválido/cookie corrompido — nunca bloqueia o login.
        }
      }

      const response = NextResponse.redirect(`${origin}/dashboard`)
      if (attributionPersisted) {
        response.cookies.delete(ATTRIBUTION_COOKIE)
      }
      return response
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
