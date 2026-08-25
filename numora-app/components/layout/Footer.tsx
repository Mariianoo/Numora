/**
 * components/layout/Footer.tsx
 * Rodapé global — só links legais (Privacidade/Termos/Cookies) e o canal
 * oficial de suporte. Montado uma única vez em app/layout.tsx, junto com
 * o resto do shell global (GTM/AttributionCapture/ConsentBanner).
 *
 * Puramente apresentacional, sem estado — não decide nada sobre sessão,
 * consentimento ou papel do usuário.
 */
import Link from 'next/link'

const SUPPORT_EMAIL = 'suporte.numora@gmail.com'

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacidade' },
  { href: '/terms', label: 'Termos de Uso' },
  { href: '/cookies', label: 'Cookies' },
]

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 text-center text-xs text-text-secondary sm:flex-row sm:justify-between sm:text-left">
        <p>Numora — Beta Fechado. Produto em fase pré-operacional.</p>
        <nav aria-label="Links legais e suporte" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-accent">
              {link.label}
            </Link>
          ))}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="transition-colors hover:text-accent">
            {SUPPORT_EMAIL}
          </a>
        </nav>
      </div>
    </footer>
  )
}
