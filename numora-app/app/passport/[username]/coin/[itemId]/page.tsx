/**
 * app/passport/[username]/coin/[itemId]/page.tsx
 * Numora Passport — cartão de identidade público de UMA moeda (Etapa
 * "F4 — Numora Labels"). É o destino do QR Code impresso nas etiquetas
 * físicas geradas pelo Labels. Mesmo padrão de `../page.tsx` (Passport do
 * colecionador): rota fora de /dashboard, sem sessão exigida, sem
 * Sidebar/Topbar, sem proteção de proxy.ts.
 *
 * Única fonte de dados: `get_public_passport_item` (`SECURITY DEFINER`) —
 * nunca query direta em `collection_items`/`profiles`. `null` cobre TODOS
 * os motivos de indisponibilidade (username não existe, Passport não é
 * público, item não existe/não é deste usuário/foi excluído/está fora do
 * modo de visibilidade escolhido) — nunca diferenciados, mesma filosofia já
 * documentada na página agregada. Todos viram `notFound()` (404 genérico).
 *
 * A etiqueta física pode existir mesmo sem o Passport estar público (Labels
 * é uma operação privada, ver features/labels) — quando isso acontece, quem
 * escaneia o QR só vê este 404 genérico, nunca uma mensagem que revele que
 * a moeda existe mas está privada.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Coins } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PublicPassportItem } from '@/features/passport/types'
import { PUBLIC_COIN_IMAGE_BUCKET } from '@/features/coin-images/types'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDateOnly } from '@/lib/format/date'

export default async function PassportCoinPage({
  params,
}: {
  params: Promise<{ username: string; itemId: string }>
}) {
  const { username, itemId } = await params
  const supabase = await getSupabaseServerClient()

  const { data, error } = await supabase.rpc('get_public_passport_item', {
    p_username: username,
    p_item_id: itemId,
  })

  if (error || !data) {
    notFound()
  }

  const passport = data as PublicPassportItem
  const { coin } = passport
  const displayName = passport.name?.trim() || passport.username

  const photoUrl = coin.photoStoragePath
    ? supabase.storage.from(PUBLIC_COIN_IMAGE_BUCKET).getPublicUrl(coin.photoStoragePath).data.publicUrl
    : null

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
            <div className="-mt-12 flex size-24 items-center justify-center overflow-hidden rounded-full bg-accent/10 ring-4 ring-surface sm:-mt-14 sm:size-28">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL pública estável do bucket coin-images-public, não é asset estático do Next
                <img src={photoUrl} alt="" className="size-full object-cover" />
              ) : (
                <Coins className="size-9 text-accent" aria-hidden />
              )}
            </div>

            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                {coin.denomination ?? 'Moeda sem denominação'}
              </h1>
              <p className="text-sm text-text-secondary">
                {coin.countryFlagEmoji ? `${coin.countryFlagEmoji} ` : ''}
                {coin.countryName ?? coin.countryCode ?? '—'} · {coin.year ?? '—'}
              </p>
            </div>

            {coin.metalName && (
              <Badge tone="accent">
                {coin.secondaryMetalName ? `${coin.metalName} + ${coin.secondaryMetalName}` : coin.metalName}
              </Badge>
            )}

            {coin.labelCode && <p className="text-xs text-text-secondary/70">{coin.labelCode}</p>}

            {coin.quantity > 1 && (
              <Badge tone="neutral">×{coin.quantity} exemplares desta emissão</Badge>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border px-6 py-5 sm:px-8">
            <Avatar name={displayName} size="sm" />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-text-primary">{displayName}</p>
              <p className="truncate text-xs text-text-secondary">
                @{passport.username} · Colecionador desde {formatDateOnly(passport.collectorSince)}
              </p>
            </div>
          </div>
        </Card>

        <Link
          href={`/passport/${passport.username}`}
          className="flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Ver Passport completo de {displayName}
        </Link>

        <p className="text-xs text-text-secondary/60">numora — gestão de coleções numismáticas</p>
      </div>
    </div>
  )
}
