/**
 * app/passport/[username]/page.tsx
 * Numora Passport — cartão de identidade público do colecionador
 * (Etapa 8.2). Rota fora de /dashboard: sem sessão exigida, sem
 * Sidebar/Topbar autenticado, sem proteção de proxy.ts (é pública por
 * natureza — só existe conteúdo se o dono ativou `passport_public`).
 *
 * Única fonte de dados: a RPC `get_public_passport` (`SECURITY DEFINER`,
 * migration `create_get_public_passport_rpc`) — nunca query direta em
 * `profiles`/`collection_items`/`purchases`. A RPC já decide
 * internamente o que é público; esta página só renderiza o que ela
 * devolve.
 *
 * `null` cobre tanto "username não existe" quanto "existe mas é
 * privado" — nunca diferenciamos os dois casos (testado contra o banco
 * antes desta página existir: ambos retornam exatamente o mesmo
 * resultado). Os dois viram `notFound()` (404 genérico do Next.js),
 * sem nenhuma mensagem que revele qual dos dois motivos ocorreu.
 */
import { notFound } from 'next/navigation'
import { Coins, Layers, Globe2, Gem, CalendarRange } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { formatDateOnly } from '@/lib/format/date'

interface PublicPassport {
  name: string | null
  username: string
  numoraId: string
  avatarUrl: string | null
  countryCode: string | null
  countryName: string | null
  countryFlagEmoji: string | null
  collectorSince: string
  totalCoins: number
  totalUnits: number
  countriesCount: number
  metalsCount: number
  minYear: number | null
  maxYear: number | null
}

export default async function PassportPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await getSupabaseServerClient()

  const { data, error } = await supabase.rpc('get_public_passport', { p_username: username })

  if (error || !data) {
    notFound()
  }

  const passport = data as PublicPassport
  const displayName = passport.name?.trim() || passport.username

  return (
    <div className="relative flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden bg-background p-6">
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-accent/10 blur-[110px]"
        aria-hidden
      />

      <div className="relative z-10 flex w-full flex-col items-center gap-6">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-wider text-text-secondary/60 uppercase">Numora</p>
          <p className="mt-1 text-sm font-medium text-accent">Numora Passport</p>
        </div>

        <Card className="w-full max-w-sm p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <Avatar name={displayName} size="md" />

            <div>
              <h1 className="text-xl font-semibold text-text-primary">{displayName}</h1>
              <p className="text-sm text-text-secondary">@{passport.username}</p>
              <p className="mt-1 text-xs font-medium text-accent">{passport.numoraId}</p>
            </div>

            {passport.countryCode && (
              <p className="text-sm text-text-secondary">
                {passport.countryFlagEmoji ? `${passport.countryFlagEmoji} ` : ''}
                {passport.countryName ?? passport.countryCode}
              </p>
            )}

            <p className="text-xs text-text-secondary">Colecionador desde {formatDateOnly(passport.collectorSince)}</p>
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <p className="text-center text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
              Resumo da coleção
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Coins className="size-4" aria-hidden />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">{passport.totalCoins}</p>
                  <p className="text-xs text-text-secondary">moedas</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Layers className="size-4" aria-hidden />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">{passport.totalUnits}</p>
                  <p className="text-xs text-text-secondary">unidades</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Globe2 className="size-4" aria-hidden />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">{passport.countriesCount}</p>
                  <p className="text-xs text-text-secondary">países</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Gem className="size-4" aria-hidden />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">{passport.metalsCount}</p>
                  <p className="text-xs text-text-secondary">metais</p>
                </div>
              </div>
            </div>

            {passport.minYear !== null && passport.maxYear !== null && (
              <div className="mt-4 flex items-center justify-center gap-2 border-t border-border pt-4 text-sm text-text-secondary">
                <CalendarRange className="size-4" aria-hidden />
                Período: {passport.minYear} — {passport.maxYear}
              </div>
            )}
          </div>
        </Card>

        <p className="text-xs text-text-secondary/60">numora — gestão de coleções numismáticas</p>
      </div>
    </div>
  )
}
