/**
 * app/explore/page.tsx
 * Passport V1 (Fase 5) — "Explorar": descoberta simples de colecionadores
 * com Passport público. Nunca é um feed social — sem seguir, curtir,
 * comentar ou notificação. Server Component, sem sessão exigida (rota
 * pública, mesmo espírito de `/passport/[username]`), paginado por
 * `?page=` na própria URL (sem estado de cliente/JS para isso).
 *
 * Única fonte de dados: a RPC `list_public_passports` (`SECURITY
 * DEFINER`, migration `create_list_public_passports_rpc`) — nunca query
 * direta em `profiles`. A RPC já filtra `passport_public = true`; esta
 * página só renderiza o que ela devolve, exatamente como
 * `/passport/[username]` faz com `get_public_passport`.
 */
import Link from 'next/link'
import { Compass, Coins, Globe2, Users } from 'lucide-react'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PublicPassportListPage } from '@/features/passport/types'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateOnly } from '@/lib/format/date'

const PAGE_SIZE = 24

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.rpc('list_public_passports', {
    p_limit: PAGE_SIZE,
    p_offset: offset,
  })

  // Falha de rede/RPC nunca vira uma tela em branco silenciosa — mas
  // também nunca vaza detalhe técnico numa rota pública sem sessão.
  const result: PublicPassportListPage = error || !data ? { entries: [], hasMore: false } : data

  return (
    <div className="min-h-full bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Compass className="size-6" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-text-primary">Explorar colecionadores</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Descubra Passports públicos de outros colecionadores no Numora.
          </p>
        </div>

        {result.entries.length === 0 && page === 1 ? (
          <EmptyState
            icon={Users}
            title="Ainda não há Passports públicos"
            description="Quando colecionadores ativarem o Passport público, eles aparecem aqui."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.entries.map((entry) => {
              const displayName = entry.name?.trim() || entry.username
              return (
                <Card key={entry.username} hoverable className="flex flex-col gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-text-primary">{displayName}</p>
                      <p className="truncate text-sm text-text-secondary">@{entry.username}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {entry.countryCode && (
                      <Badge tone="neutral">
                        {entry.countryFlagEmoji ? `${entry.countryFlagEmoji} ` : ''}
                        {entry.countryName ?? entry.countryCode}
                      </Badge>
                    )}
                    <Badge tone="accent">
                      <Coins className="size-3" aria-hidden />
                      {entry.totalCoins}
                    </Badge>
                    <Badge tone="accent">
                      <Globe2 className="size-3" aria-hidden />
                      {entry.countriesCount}
                    </Badge>
                  </div>

                  <p className="text-xs text-text-secondary">Colecionador desde {formatDateOnly(entry.collectorSince)}</p>

                  <Link href={`/passport/${entry.username}`} className="mt-auto">
                    <Button type="button" variant="secondary" className="w-full">
                      Ver Passport
                    </Button>
                  </Link>
                </Card>
              )
            })}
          </div>
        )}

        {(page > 1 || result.hasMore) && (
          <div className="flex items-center justify-center gap-3">
            {page > 1 && (
              <Link href={page === 2 ? '/explore' : `/explore?page=${page - 1}`}>
                <Button type="button" variant="secondary">
                  Página anterior
                </Button>
              </Link>
            )}
            {result.hasMore && (
              <Link href={`/explore?page=${page + 1}`}>
                <Button type="button" variant="secondary">
                  Próxima página
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
