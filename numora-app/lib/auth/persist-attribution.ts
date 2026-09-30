/**
 * lib/auth/persist-attribution.ts
 * Etapa "B2.4 — Signup server-controlled" — persistência da atribuição de
 * first-touch (cookie `numora_attribution`, que só existe se o visitante
 * consentiu marketing) no momento em que a conta é confirmada. Mesma
 * garantia de app/auth/callback/route.ts: `upsert(..., ignoreDuplicates)`
 * nunca sobrescreve uma linha existente e qualquer falha é engolida pelo
 * chamador (atribuição é enriquecimento, nunca caminho crítico).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ATTRIBUTION_COOKIE = 'numora_attribution'

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

/** `true` se a linha foi gravada (o chamador então apaga o cookie). Lança em JSON inválido/erro de rede. */
export async function persistAttributionFromCookie(supabase: SupabaseClient, userId: string, cookieValue: string): Promise<boolean> {
  const attribution = JSON.parse(decodeURIComponent(cookieValue)) as StoredAttribution

  const { error } = await supabase.from('user_acquisition').upsert(
    {
      user_id: userId,
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

  return !error
}
