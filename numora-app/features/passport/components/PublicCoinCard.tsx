/**
 * features/passport/components/PublicCoinCard.tsx
 * Etapa "F5 — Passport V2 Visual" — card individual da seção "Coleção" do
 * Passport público, redesenhado como uma pequena vitrine/"slab" numismático
 * (inspirado CONCEITUALMENTE na apresentação de peças catalogadas — moldura
 * + imagem em destaque + ficha técnica abaixo; nenhum design proprietário
 * de terceiros copiado, só a convenção genérica "imagem emoldurada + ficha
 * técnica" já universal em catálogos numismáticos).
 *
 * Client Component só por causa da expansão (`useState`) — o Server
 * Component pai (`app/passport/[username]/page.tsx`) continua sendo o
 * único a chamar a RPC; este componente só recebe props já resolvidas
 * (inclusive `photoUrl`, calculado ali via `getPublicUrl`, síncrono, sem
 * request de rede extra por moeda — nenhum N+1 introduzido).
 *
 * DOIS toggles independentes, nunca aninhados um dentro do outro (HTML não
 * permite `<button>` dentro de `<button>`): o botão principal (expande a
 * ficha técnica) e o botão "i" (revela a nota de informações históricas)
 * são irmãos, cada um com seu próprio `aria-expanded`/`aria-controls`.
 *
 * `coin.labelCode` (ver `features/passport/types.ts`) — `get_public_passport`
 * estendida (migration `20260905100000_add_label_code_to_public_passport.sql`,
 * aplicada em DEV) para devolver esse campo. `null` até a primeira geração
 * de etiqueta da moeda — nenhuma chamada a `ensure_label_codes` acontece
 * aqui, só leitura do que a RPC devolver. Exibido visualmente secundário
 * (texto pequeno, cor discreta), nunca como destaque do card, e sem
 * aumentar o tamanho do card.
 *
 * Nota histórica (auditoria desta etapa, ver relatório): `history`/
 * `trivia`/`mint`/`mintage`/`catalogReferences` existem em
 * `collection_items`, mas são DELIBERADAMENTE nunca retornados por nenhuma
 * RPC pública (decisão já tomada no Passport V1 — podem conter anotação
 * pessoal do colecionador). Por isso o botão "i" mostra um aviso
 * genérico, nunca esses campos.
 */
'use client'

import { useId, useState } from 'react'
import { Coins, Info, X } from 'lucide-react'

import type { PublicPassportCoin } from '../types'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/components/ui/utils'

export interface PublicCoinCardProps {
  coin: PublicPassportCoin
  photoUrl: string | null
}

export function PublicCoinCard({ coin, photoUrl }: PublicCoinCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const detailsId = useId()
  const infoId = useId()

  const originLabel = [
    coin.countryFlagEmoji ? `${coin.countryFlagEmoji} ${coin.countryName ?? coin.countryCode ?? ''}`.trim() : coin.countryName,
    coin.year !== null ? String(coin.year) : null,
  ]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(' · ')

  const compositionLabel = [coin.metalName, coin.secondaryMetalName].filter(Boolean).join(' + ')

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        className="flex w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-accent/15 to-surface-hover">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL pública estável do bucket coin-images-public, não é asset estático do Next
            <img
              src={photoUrl}
              alt={coin.denomination ? `Foto de ${coin.denomination}` : 'Foto da moeda'}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              {coin.countryFlagEmoji ? (
                <span className="text-4xl" aria-hidden>
                  {coin.countryFlagEmoji}
                </span>
              ) : (
                <Coins className="size-10 text-accent/60" aria-hidden />
              )}
            </div>
          )}
          {/* Moldura sutil dentro da imagem — remete a uma peça emoldurada, sem exagero de sombra/animação. */}
          <div className="pointer-events-none absolute inset-2 rounded-lg ring-1 ring-white/15" aria-hidden />
        </div>

        <div className="flex flex-col gap-1 p-3.5">
          <p className="truncate text-sm font-semibold text-text-primary">{coin.denomination ?? 'Sem denominação'}</p>
          {originLabel && <p className="truncate text-xs text-text-secondary">{originLabel}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {compositionLabel && <Badge tone="accent">{compositionLabel}</Badge>}
            {coin.quantity > 1 && <Badge tone="neutral">×{coin.quantity}</Badge>}
            {coin.labelCode && (
              <span className="text-[11px] font-medium tracking-wide text-text-secondary/70">{coin.labelCode}</span>
            )}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => setIsInfoOpen((current) => !current)}
        aria-expanded={isInfoOpen}
        aria-controls={infoId}
        aria-label={isInfoOpen ? 'Fechar informações históricas' : 'Ver informações históricas'}
        className={cn(
          'absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-background/70 text-text-primary backdrop-blur-sm transition-colors',
          'hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        )}
      >
        {isInfoOpen ? <X className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
      </button>

      {isInfoOpen && (
        <div id={infoId} className="border-t border-border bg-surface-hover px-3.5 py-3 text-xs text-text-secondary">
          Informações históricas desta emissão estarão disponíveis em breve.
        </div>
      )}

      {isExpanded && (
        <div id={detailsId} className="flex flex-col gap-1.5 border-t border-border px-3.5 py-3 text-xs text-text-secondary">
          {coin.countryName && <p>País de cunhagem: {coin.countryName}</p>}
          {compositionLabel && <p>Composição: {compositionLabel}</p>}
          {coin.quantity > 1 && <p>{coin.quantity} exemplares desta emissão nesta coleção.</p>}
          {!coin.countryName && !compositionLabel && coin.quantity <= 1 && <p>Sem detalhes adicionais publicados.</p>}
        </div>
      )}
    </div>
  )
}
