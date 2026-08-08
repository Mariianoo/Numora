/**
 * next.config.js
 * Configuração base do Next.js (App Router). Nenhuma regra de negócio aqui —
 * apenas infraestrutura (PROJECT_RULES.md §10).
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async headers() {
    return [
      {
        // Headers de segurança base (PROJECT_RULES.md §13.4).
        // Regras de CSP detalhadas são refinadas conforme domínios de
        // integração forem confirmados (IA, pagamento) — placeholder seguro
        // por padrão nesta Sprint Foundation.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
