/**
 * components/ui/NumoraLogo.tsx
 * Identidade visual Numora — usa os arquivos oficiais aprovados em
 * `public/brand/` (raster, fornecidos pelo proprietário do produto).
 * Este componente NÃO desenha o logo — só decide QUAL arquivo oficial
 * exibir e em que tamanho, preservando a proporção original de cada um.
 *
 * - `variant="full"` — logo completo (moeda+louro+N + "NUMORA" + linha
 *   dourada dividida por losango + tagline), já com todos esses
 *   elementos embutidos na imagem. `theme` escolhe o arquivo para fundo
 *   escuro ou claro.
 * - `variant="mark"` — só o símbolo (moeda). `markDetail="official"`
 *   (padrão) usa o símbolo com louro; `markDetail="reduced"` usa a
 *   variante sem louro, reservada a contextos muito compactos.
 *
 * `size` é a ALTURA renderizada em px (largura derivada da proporção
 * real do arquivo). Para dimensionamento responsivo por largura (ex.:
 * hero da landing), omita `size` e controle via `className`.
 */
import Image from 'next/image'

const LOGO_DARK = { src: '/brand/numora-logo-dark.png', width: 795, height: 214 }
const LOGO_LIGHT = { src: '/brand/numora-logo-light.png', width: 705, height: 214 }
const MARK_OFFICIAL = { src: '/brand/numora-symbol-laurel.png', width: 1024, height: 1024 }
const MARK_REDUCED = { src: '/brand/numora-symbol-reduced.png', width: 1024, height: 1024 }

export type NumoraLogoVariant = 'full' | 'mark'
export type NumoraLogoTheme = 'dark' | 'light'
export type NumoraMarkDetail = 'official' | 'reduced'

export interface NumoraLogoProps {
  variant?: NumoraLogoVariant
  theme?: NumoraLogoTheme
  /** Altura renderizada em px. Omitido = sem estilo inline de tamanho (controle via `className`). */
  size?: number
  /** Só tem efeito com `variant="mark"` — `"official"` (padrão, com louro) ou `"reduced"` (sem louro, contextos compactos). */
  markDetail?: NumoraMarkDetail
  className?: string
  /** `priority` do `next/image` — usar em conteúdo acima da dobra (ex.: hero da landing). */
  priority?: boolean
}

export function NumoraLogo({ variant = 'full', theme = 'dark', size, markDetail = 'official', className, priority }: NumoraLogoProps) {
  const asset =
    variant === 'mark' ? (markDetail === 'official' ? MARK_OFFICIAL : MARK_REDUCED) : theme === 'dark' ? LOGO_DARK : LOGO_LIGHT

  const alt = variant === 'mark' ? 'Numora' : 'Numora — Sua coleção, para sempre'

  return (
    <Image
      src={asset.src}
      alt={alt}
      width={asset.width}
      height={asset.height}
      priority={priority}
      className={className}
      style={size ? { height: size, width: 'auto' } : undefined}
    />
  )
}
