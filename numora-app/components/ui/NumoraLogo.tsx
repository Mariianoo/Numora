/**
 * components/ui/NumoraLogo.tsx
 * Identidade visual Numora — componente único, reutilizável, para não
 * duplicar SVG/markup do logo em cada lugar que hoje só escreve o texto
 * "NUMORA." (Sidebar, Topbar, AdminSidebar, AuthShell, landing).
 *
 * Duas famílias de símbolo, ambas com a MESMA geometria dos assets
 * estáticos em `public/brand/`:
 * - `NumoraMarkLaurel` (símbolo OFICIAL — moeda + N + ramos de louro,
 *   igual a `numora-symbol-laurel.svg`) — usado sempre que houver espaço,
 *   inclusive dentro do `variant="full"`. NUNCA trocado pelo reduzido só
 *   por conveniência.
 * - `NumoraMarkReduced` (símbolo REDUZIDO — moeda + N sem os ramos, igual
 *   a `numora-symbol.svg`) — reservado para contextos que exigem
 *   simplificação por tamanho (favicon/PWA/Apple touch icon são arquivos
 *   estáticos, não passam por este componente; aqui existe só para uso
 *   futuro em UI muito compacta que precise do mesmo tratamento).
 *
 * `variant="mark"` — só o símbolo isolado; `markDetail` escolhe qual
 * (`"official"` com louro, padrão; `"reduced"` sem louro, opt-in).
 * `variant="full"` — símbolo oficial (sempre com louro) + wordmark
 * "NUMORA" + linha dourada dividida por losango + tagline opcional.
 * `theme` só afeta a cor do WORDMARK/tagline (o símbolo já é autocontido:
 * disco navy + aro dourado funcionam sobre qualquer fundo).
 * `size` define a ALTURA renderizada em px; a largura é derivada da
 * proporção real de cada variante (1:1 para `mark`, 3.2:1 para `full`).
 *
 * `'use client'` só existe por causa de `useId()` (id de gradiente único
 * por instância — dois `<NumoraLogo>` na mesma página não podem
 * compartilhar o `id` do `<linearGradient>`). Continua podendo ser
 * renderizado a partir de Server Components normalmente (ex.: `app/page.tsx`).
 */
'use client'

import { useId } from 'react'

const GOLD_GRADIENT_STOPS = [
  { offset: '0%', color: '#F5DE9E' },
  { offset: '45%', color: '#D4AF37' },
  { offset: '100%', color: '#B8860B' },
] as const

const COIN_RIM_DOTS = [
  [100.0, 12.0],
  [133.7, 18.7],
  [162.2, 37.8],
  [181.3, 66.3],
  [188.0, 100.0],
  [181.3, 133.7],
  [162.2, 162.2],
  [133.7, 181.3],
  [100.0, 188.0],
  [66.3, 181.3],
  [37.8, 162.2],
  [18.7, 133.7],
  [12.0, 100.0],
  [18.7, 66.3],
  [37.8, 37.8],
  [66.3, 18.7],
] as const

/** 5 folhas de cada lado, concentradas no terço inferior perto do aro (longe do N) — mesmos pontos de `numora-symbol-laurel.svg`. */
const LAUREL_LEAVES = [
  [87.85, 168.94, -170],
  [70.42, 163.44, -155],
  [55.0, 153.62, -140],
  [42.66, 140.15, -125],
  [34.22, 123.94, -110],
  [112.15, 168.94, 170],
  [129.58, 163.44, 155],
  [145.0, 153.62, 140],
  [157.34, 140.15, 125],
  [165.78, 123.94, 110],
] as const

const LEAF_PATH = 'M0,0 C6,7 6,19 0,26 C-6,19 -6,7 0,0 Z'

function GoldDefs({ gradientId }: { gradientId: string }) {
  return (
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        {GOLD_GRADIENT_STOPS.map((stop) => (
          <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
        ))}
      </linearGradient>
    </defs>
  )
}

function CoinBase({ gradientId }: { gradientId: string }) {
  return (
    <>
      <circle cx="100" cy="100" r="94" fill="none" stroke={`url(#${gradientId})`} strokeWidth="4" />
      <g fill={`url(#${gradientId})`}>
        {COIN_RIM_DOTS.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.8" />
        ))}
      </g>
      <circle cx="100" cy="100" r="80" fill="#0B1F3B" />
      <circle cx="100" cy="100" r="80" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.6" opacity="0.85" />
    </>
  )
}

function MonogramN({ gradientId }: { gradientId: string }) {
  return (
    <g transform="translate(67,64)" fill={`url(#${gradientId})`}>
      <rect x="0" y="0" width="18" height="72" />
      <rect x="48" y="0" width="18" height="72" />
      <polygon points="18,0 36,0 66,72 48,72" />
    </g>
  )
}

/** Símbolo OFICIAL — moeda + N + ramos de louro (`numora-symbol-laurel.svg`). */
function NumoraMarkLaurel({ gradientId }: { gradientId: string }) {
  return (
    <>
      <GoldDefs gradientId={gradientId} />
      <CoinBase gradientId={gradientId} />
      <g fill={`url(#${gradientId})`}>
        {LAUREL_LEAVES.map(([x, y, rotation]) => (
          <path key={`${x}-${y}`} d={LEAF_PATH} transform={`translate(${x},${y}) rotate(${rotation})`} />
        ))}
      </g>
      <MonogramN gradientId={gradientId} />
    </>
  )
}

/** Símbolo REDUZIDO — moeda + N, sem ramos (`numora-symbol.svg`) — só para contextos que exigem simplificação por tamanho. */
function NumoraMarkReduced({ gradientId }: { gradientId: string }) {
  return (
    <>
      <GoldDefs gradientId={gradientId} />
      <CoinBase gradientId={gradientId} />
      <MonogramN gradientId={gradientId} />
    </>
  )
}

export type NumoraLogoVariant = 'full' | 'mark'
export type NumoraLogoTheme = 'dark' | 'light'
export type NumoraMarkDetail = 'official' | 'reduced'

export interface NumoraLogoProps {
  variant?: NumoraLogoVariant
  theme?: NumoraLogoTheme
  /** Altura renderizada em px — a largura é derivada da proporção real de cada variante. */
  size?: number
  /** Só tem efeito com `variant="full"`. */
  withTagline?: boolean
  /**
   * Só tem efeito com `variant="mark"` — `"official"` (padrão, com louro)
   * ou `"reduced"` (sem louro, só para contextos que exigem simplificação
   * por tamanho). `variant="full"` sempre usa o símbolo oficial.
   */
  markDetail?: NumoraMarkDetail
  className?: string
}

const WORDMARK_FONT = "Georgia, 'Times New Roman', serif"

export function NumoraLogo({
  variant = 'full',
  theme = 'dark',
  size,
  withTagline = false,
  markDetail = 'official',
  className,
}: NumoraLogoProps) {
  // `useId()` inclui `:` (ex.: ":r0:") — inválido como fragmento de `url(#...)`
  // em alguns mecanismos de renderização SVG, por isso removido aqui.
  const reactId = useId().replace(/:/g, '')
  const gradientId = `numoraGold-${reactId}`

  if (variant === 'mark') {
    const height = size ?? 32
    return (
      <svg viewBox="0 0 200 200" width={height} height={height} role="img" aria-label="Numora" className={className}>
        {markDetail === 'official' ? (
          <NumoraMarkLaurel gradientId={gradientId} />
        ) : (
          <NumoraMarkReduced gradientId={gradientId} />
        )}
      </svg>
    )
  }

  const wordmarkColor = theme === 'dark' ? '#F9F6EE' : '#0B1F3B'
  const wordmarkShadowColor = theme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(11,31,59,0.25)'
  const taglineColor = theme === 'dark' ? '#D4AF37' : '#8A6D1F'
  const viewBoxHeight = 200
  const height = size ?? 40
  const width = (height * 640) / viewBoxHeight

  return (
    <svg
      viewBox={`0 0 640 ${viewBoxHeight}`}
      width={width}
      height={height}
      role="img"
      aria-label="Numora — Sua coleção, para sempre"
      className={className}
    >
      <g transform="translate(15,20) scale(0.8)">
        <NumoraMarkLaurel gradientId={gradientId} />
      </g>

      <text x="199" y="121" fontFamily={WORDMARK_FONT} fontWeight="700" fontSize="82" letterSpacing="2" fill={wordmarkShadowColor}>
        NUMORA
      </text>
      <text x="196" y="118" fontFamily={WORDMARK_FONT} fontWeight="700" fontSize="82" letterSpacing="2" fill={wordmarkColor}>
        NUMORA
      </text>

      <rect x="196" y="140" width="130" height="1.6" fill={`url(#${gradientId})`} />
      <rect x="352" y="140" width="130" height="1.6" fill={`url(#${gradientId})`} />
      <rect x="333" y="133" width="13" height="13" fill={`url(#${gradientId})`} transform="rotate(45 339.5 139.5)" />

      {withTagline && (
        <text
          x="339"
          y="172"
          textAnchor="middle"
          fontFamily={WORDMARK_FONT}
          fontSize="16"
          letterSpacing="3.5"
          fill={taglineColor}
        >
          SUA COLEÇÃO, PARA SEMPRE.
        </text>
      )}
    </svg>
  )
}
