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
 * nunca país).
 *
 * Etapa "B2 — Signup + Legal": `handle_new_user()` passou a gravar país/nome/
 * e-mail (e os consentimentos) na CRIAÇÃO do usuário, então confirmar o
 * e-mail em OUTRO navegador (PKCE falha → auth_callback_failed) não perde
 * mais nenhum dado do cadastro. Aqui o país só é preenchido se ainda
 * estiver vazio (nunca sobrescreve); ver lib/auth/callback-profile.ts.
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

import { resolveCallbackProfileFields } from '@/lib/auth/callback-profile'
import { captureAuthError } from '@/lib/monitoring/capture-auth-error'
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

    if (error) {
      captureAuthError('auth_callback', error)
    }

    if (!error) {
      const user = data.user
      const { base, countryToFill } = resolveCallbackProfileFields(user)

      // Etapa "B2": nome/e-mail e país são UPDATEs separados — um país
      // inválido nunca derruba a atualização de nome/e-mail — e erros deixam
      // de ser ignorados em silêncio (vão ao Sentry sem dados do usuário).
      // Nunca bloqueia o login: o profile já nasceu completo pelo trigger.
      if (Object.keys(base).length > 0) {
        const { error: profileError } = await supabase.from('profiles').update(base).eq('id', user.id)
        if (profileError) {
          captureAuthError('auth_callback_profile', profileError)
        }
      }

      if (countryToFill) {
        // Só preenche se ainda estiver vazio: nunca sobrescreve um país já
        // definido (pelo trigger no cadastro ou editado pelo usuário).
        const { error: countryError } = await supabase
          .from('profiles')
          .update({ country_code: countryToFill })
          .eq('id', user.id)
          .is('country_code', null)
        if (countryError) {
          captureAuthError('auth_callback_profile', countryError)
        }
      }

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
        } catch (err) {
          // JSON inválido/cookie corrompido — nunca bloqueia o login.
          captureAuthError('auth_callback', err)
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
