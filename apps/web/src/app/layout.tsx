import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { APP_NAME } from '@/config/constants'
import '@/styles/globals.css'

// NOTE: AppProviders (Query/Theme/Toast/ErrorBoundary/i18n) é composto aqui
// na Sprint Foundation seguinte deste mesmo lote — ver providers/app-providers.tsx.
import { AppProviders } from '@/providers/app-providers'

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Numora — catalogação, avaliação e comunidade para colecionadores de moedas, cédulas, medalhas e tokens.',
  manifest: '/manifest.webmanifest',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#121110' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
