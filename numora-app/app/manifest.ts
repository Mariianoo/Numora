import type { MetadataRoute } from 'next'

/**
 * app/manifest.ts
 * Convenção nativa do Next.js App Router — gera `/manifest.webmanifest`
 * automaticamente, sem dependência nova (`next-pwa` etc.) e sem service
 * worker (fora do escopo desta etapa; só o manifest, para o app ser
 * "instalável" e ter ícone/tema corretos quando adicionado à tela inicial).
 *
 * Ícones apontam para `public/icons/`, gerados a partir do símbolo Numora
 * aprovado (`public/brand/numora-symbol.svg`) — nunca duplicados à mão.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Numora',
    short_name: 'Numora',
    description: 'Gestão profissional de coleções numismáticas.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0D10',
    theme_color: '#0B1F3B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
