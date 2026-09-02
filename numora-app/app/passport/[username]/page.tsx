/**
 * app/passport/[username]/page.tsx
 * Numora Passport — cartão de identidade público do colecionador
 * (Etapa 8.2). Rota fora de /dashboard: sem sessão exigida, sem
 * Sidebar/Topbar autenticado, sem proteção de proxy.ts (é pública por
 * natureza — só existe conteúdo se o dono ativou `passport_public`).
 *
 * Única fonte de dados: a RPC `get_public_passport` (`SECURITY DEFINER`,
 * migration `create_get_public_passport_rpc` + `update_get_public_passport_rpc`
 * do Passport V1) — nunca query direta em
 * `profiles`/`collection_items`/`purchases`. A RPC já decide
 * internamente o que é público; esta página só renderiza o que ela
 * devolve.
 *
 * `null` cobre tanto "username não existe" quanto "existe mas é
 * privado" — nunca diferenciamos os dois casos (testado contra o banco
 * antes desta página existir: ambos retornam exatamente o mesmo
 * resultado). Os dois viram `notFound()` (404 genérico do Next.js),
 * sem nenhuma mensagem que revele qual dos dois motivos ocorreu.
 *
 * Passport V1 (Fase 2/3) — a mesma lógica de "nunca diferenciar motivos"
 * se estende à lista de moedas: `coins.length === 0` mostra o MESMO
 * estado vazio esteja o modo de visibilidade em 'none' (dono nunca quis
 * mostrar moedas) ou em 'selected' sem nenhuma marcada ainda — a página
 * nunca expõe `collectionVisibility` na tela, só usa esse campo
 * internamente para decidir o texto do estado vazio (nada específico do
 * modo, ver EMPTY_COLLECTION_MESSAGE).
 *
 * Ajuste pré-commit: `numoraId` não é mais exibido aqui (a RPC também
 * parou de devolvê-lo — ver features/passport/types.ts). Banner do
 * cabeçalho é só CSS (gradiente sobre os tokens de cor existentes,
 * `bg-accent`/`bg-surface`) — sem upload, sem Storage, sem tabela nova;
 * `Card` é usado sem padding próprio (`overflow-hidden` recorta o banner
 * nos cantos arredondados) para o banner poder colar na borda do cartão.
 */
import { notFound } from 'next/navigation'
import { Coins, Layers, Globe2, Gem, CalendarRange, PackageOpen } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PublicPassport } from '@/features/passport/types'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateOnly } from '@/lib/format/date'

const EMPTY_COLLECTION_MESSAGE = 'Este colecionador ainda não publicou moedas no Passport.'

export default async function PassportPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await getSupabaseServerClient()

  const { data, error } = await supabase.rpc('get_public_passport', { p_username: username })

  if (error || !data) {
    notFound()
  }

  const passport = data as PublicPassport
  const displayName = passport.name?.trim() || passport.username

  const stats = [
    { icon: Coins, value: passport.totalCoins, label: 'moedas' },
    { icon: Layers, value: passport.totalUnits, label: 'unidades' },
    { icon: Globe2, value: passport.countriesCount, label: 'países' },
    { icon: Gem, value: passport.metalsCount, label: 'metais' },
  ]

  return (
    <div className="relative flex min-h-full flex-1 flex-col items-center overflow-x-hidden bg-background px-4 py-10 sm:px-6">
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-accent/10 blur-[110px]"
        aria-hidden
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-wider text-text-secondary/60 uppercase">Numora</p>
          <p className="mt-1 text-sm font-medium text-accent">Numora Passport</p>
        </div>

        <Card className="w-full overflow-hidden">
          <div
            className="h-24 w-full bg-gradient-to-br from-accent/30 via-accent/10 to-transparent sm:h-28"
            aria-hidden
          />

          <div className="flex flex-col items-center gap-4 px-6 pt-0 pb-6 text-center sm:px-8 sm:pb-8">
            <Avatar name={displayName} size="lg" className="-mt-12 ring-4 ring-surface sm:-mt-14" />

            <div>
              <h1 className="text-xl font-semibold text-text-primary">{displayName}</h1>
              <p className="text-sm text-text-secondary">@{passport.username}</p>
            </div>

            {passport.countryCode && (
              <Badge tone="neutral">
                {passport.countryFlagEmoji ? `${passport.countryFlagEmoji} ` : ''}
                {passport.countryName ?? passport.countryCode}
              </Badge>
            )}

            <p className="text-xs text-text-secondary">Colecionador desde {formatDateOnly(passport.collectorSince)}</p>
          </div>

          <div className="border-t border-border px-6 pt-6 pb-6 sm:px-8 sm:pb-8">
            <p className="text-center text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
              Resumo da coleção
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4">
              {stats.map(({ icon: Icon, value, label }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-text-primary">{value}</p>
                    <p className="text-xs text-text-secondary">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {passport.minYear !== null && passport.maxYear !== null && (
              <div className="mt-4 flex items-center justify-center gap-2 border-t border-border pt-4 text-sm text-text-secondary">
                <CalendarRange className="size-4" aria-hidden />
                Período: {passport.minYear} — {passport.maxYear}
              </div>
            )}
          </div>
        </Card>

        <div className="w-full">
          <p className="mb-3 text-center text-[11px] font-semibold tracking-wider text-text-secondary/60 uppercase">
            Coleção
          </p>

          {passport.coins.length === 0 ? (
            <EmptyState icon={PackageOpen} title={EMPTY_COLLECTION_MESSAGE} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {passport.coins.map((coin, index) => (
                <Card key={index} className="flex items-center gap-3 p-3.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-lg">
                    {coin.countryFlagEmoji ?? <Coins className="size-4 text-accent" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {coin.denomination ?? 'Sem denominação'}
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {coin.countryName ?? coin.countryCode ?? '—'} · {coin.year ?? '—'}
                      {coin.metalName ? ` · ${coin.metalName}` : ''}
                    </p>
                  </div>
                  {coin.quantity > 1 && (
                    <Badge tone="neutral" className="shrink-0">
                      ×{coin.quantity}
                    </Badge>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-text-secondary/60">numora — gestão de coleções numismáticas</p>
      </div>
    </div>
  )
}
