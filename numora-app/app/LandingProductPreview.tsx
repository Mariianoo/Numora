/**
 * app/LandingProductPreview.tsx
 * Etapa 15.10.11 — representação visual do produto na landing pública.
 *
 * Estratégia visual (fallback aprovado — Opção 2, ver relatório da etapa):
 * screenshots reais não foram possíveis nesta etapa (sem sessão
 * autenticada disponível no ambiente — banco de dados indisponível para
 * criar um usuário de teste descartável). Este componente usa os MESMOS
 * componentes reais do design system (`Card`, `Badge`, `StatCard`,
 * `Avatar`) que o produto autenticado usa — não é um mock visual à parte,
 * é literalmente a mesma UI, só com conteúdo de exemplo.
 *
 * Regras seguidas (aprovadas pelo responsável pelo produto):
 * - números redondos/claramente ilustrativos, nunca parecendo métrica real
 *   com precisão de centavos;
 * - nenhum nome de pessoa real ou fictício com aparência de dado real —
 *   "Sua coleção"/"Moeda de exemplo", nunca um nome próprio;
 * - só mostra capacidades que existem de verdade: estatísticas do
 *   Dashboard, cards de item da Coleção, resumo do Passport — nada além
 *   disso;
 * - Server Component puro, sem estado, sem dado de rede.
 */
import { Coins, Layers, Globe2, Wallet, Gem, CalendarRange } from 'lucide-react'

import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { Avatar } from '@/components/ui/Avatar'

interface ExampleItem {
  denomination: string
  countryFlag: string
  countryName: string
  status: string
}

const EXAMPLE_ITEMS: ExampleItem[] = [
  { denomination: 'Moeda de exemplo', countryFlag: '🇧🇷', countryName: 'Brasil', status: '🟢 Na coleção' },
  { denomination: 'Moeda de exemplo', countryFlag: '🇵🇹', countryName: 'Portugal', status: '🟢 Na coleção' },
  { denomination: 'Moeda de exemplo', countryFlag: '🇦🇷', countryName: 'Argentina', status: '🟢 Na coleção' },
]

export function LandingProductPreview() {
  return (
    <div className="flex flex-col gap-6">
      {/* Dashboard — mesmos StatCard usados em app/dashboard/page.tsx */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Coins} label="Moedas" value="12" description="Itens cadastrados" />
        <StatCard icon={Layers} label="Unidades" value="15" description="Peças na coleção" />
        <StatCard icon={Globe2} label="Países" value="5" description="Países representados" />
        <StatCard icon={Wallet} label="Investido" value="—" description="Você decide o que mostrar" />
      </div>

      {/* Coleção — cards de item, mesmo padrão visual de app/dashboard/collection/page.tsx */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {EXAMPLE_ITEMS.map((item, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-text-primary">{item.denomination}</p>
              <Badge tone="success">{item.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {item.countryFlag} {item.countryName}
            </p>
            <p className="mt-3 text-xs text-text-secondary">1 exemplar · com foto</p>
          </Card>
        ))}
      </div>

      {/* Passport — mesmo padrão visual de app/passport/[username]/page.tsx */}
      <Card className="mx-auto w-full max-w-xs p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar name="Sua coleção" size="md" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Seu Passport</p>
            <p className="text-xs text-text-secondary">Resumo público, se você decidir ativar</p>
          </div>
          <div className="mt-2 grid w-full grid-cols-3 gap-2 border-t border-border pt-4 text-center">
            <div>
              <Gem className="mx-auto size-4 text-accent" aria-hidden />
              <p className="mt-1 text-xs text-text-secondary">metais</p>
            </div>
            <div>
              <Globe2 className="mx-auto size-4 text-accent" aria-hidden />
              <p className="mt-1 text-xs text-text-secondary">países</p>
            </div>
            <div>
              <CalendarRange className="mx-auto size-4 text-accent" aria-hidden />
              <p className="mt-1 text-xs text-text-secondary">período</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
