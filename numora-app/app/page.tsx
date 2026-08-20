/**
 * app/page.tsx
 * Landing pública — Etapa 15.10.11 (Numora Public Product Experience).
 *
 * Server Component estático, sem verificação de sessão — mesmo
 * comportamento de antes desta etapa (proxy.ts nunca protegeu `/`; os
 * CTAs sempre apontam para /signup e /login, que já tratam sessão
 * existente em suas próprias páginas). Nenhuma lógica de autenticação
 * nova foi introduzida aqui de propósito.
 *
 * Só apresenta funcionalidades confirmadas no código (auditoria da
 * etapa): CRUD de coleção, exemplares com fotos, custo de aquisição,
 * busca/filtro, estatísticas do Dashboard, Passport público. Nenhuma
 * menção a IA, identificação automática, avaliação de mercado,
 * marketplace, comunidade ou qualquer funcionalidade que não exista.
 *
 * Preview visual (`LandingProductPreview`): screenshots reais não foram
 * possíveis nesta etapa (sem sessão autenticada disponível no ambiente —
 * ver relatório) — usa o fallback aprovado (Opção 2), os mesmos
 * componentes reais do design system, com conteúdo claramente
 * ilustrativo.
 */
import Link from 'next/link'
import { Coins, Layers, Search, Wallet, IdCard, UserPlus, PackagePlus, LineChart } from 'lucide-react'

import { LandingViewTracker } from '@/components/analytics/LandingViewTracker'
import { LandingProductPreview } from './LandingProductPreview'
import { Card } from '@/components/ui/Card'
import { cn } from '@/components/ui/utils'

const CTA_PRIMARY_CLASSES = cn(
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-medium transition-colors active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'bg-accent text-background shadow-sm hover:bg-accent-hover',
)

const CTA_SECONDARY_CLASSES = cn(
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-medium transition-colors active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'bg-surface-hover text-text-primary border border-border hover:bg-surface',
)

const BENEFITS = [
  {
    icon: Coins,
    title: 'Organize suas moedas',
    description: 'Cadastre cada moeda com país, ano, metal, peso e as informações que importam para você.',
  },
  {
    icon: Layers,
    title: 'Registre cada exemplar',
    description: 'Mais de um exemplar da mesma moeda? Cada um com suas próprias fotos, conservação e custo.',
  },
  {
    icon: Search,
    title: 'Encontre qualquer peça em segundos',
    description: 'Busca, filtros e agrupamento por país, metal, conservação ou status.',
  },
  {
    icon: Wallet,
    title: 'Acompanhe sua coleção',
    description: 'Estatísticas reais: quantas moedas, quantos países, quanto você já investiu.',
  },
]

const FLOW_STEPS = [
  { icon: UserPlus, title: 'Crie sua conta' },
  { icon: Coins, title: 'Adicione suas moedas' },
  { icon: PackagePlus, title: 'Registre seus exemplares' },
  { icon: LineChart, title: 'Acompanhe sua coleção' },
]

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingViewTracker />

      {/* HERO */}
      <section className="relative overflow-hidden px-6 py-20 sm:py-28">
        <div
          className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-accent/10 blur-[110px]"
          aria-hidden
        />
        <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">Numora</p>
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-5xl">
            Sua coleção em ordem, sob controle e pronta para crescer.
          </h1>
          <p className="max-w-lg text-base text-text-secondary sm:text-lg">
            Organize suas moedas, registre cada exemplar e acompanhe sua coleção em um só lugar.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className={CTA_PRIMARY_CLASSES}>
              Começar minha coleção
            </Link>
            <Link href="/login" className={CTA_SECONDARY_CLASSES}>
              Entrar
            </Link>
          </div>
        </div>
      </section>

      {/* PROBLEMA */}
      <section className="border-t border-border bg-surface/40 px-6 py-16">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 text-center">
          <h2 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            Sua coleção merece mais do que planilhas e fotos soltas.
          </h2>
          <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
            <Card className="p-5">
              <p className="text-sm text-text-secondary">
                Informações espalhadas entre planilhas, fotos no celular e anotações soltas.
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-text-secondary">
                Difícil lembrar exatamente o que você tem, de onde veio e quanto custou.
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-text-secondary">
                Exemplares sem histórico — cada peça merece seu próprio registro, não só um número numa lista.
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-text-secondary">
                Fotos, custos e observações guardados em lugares diferentes, difíceis de juntar.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* COMO O NUMORA AJUDA */}
      <section className="px-6 py-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-10">
          <h2 className="text-center text-2xl font-semibold text-text-primary sm:text-3xl">Como o Numora ajuda</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((benefit) => (
              <Card key={benefit.title} className="p-5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <benefit.icon className="size-[18px]" aria-hidden />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-text-primary">{benefit.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{benefit.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* PRODUTO REAL / PREVIEW */}
      <section className="border-t border-border bg-surface/40 px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-text-primary sm:text-3xl">Veja como fica sua coleção</h2>
            <p className="mt-2 text-sm text-text-secondary">
              A mesma interface que você vai usar depois de criar sua conta.
            </p>
          </div>
          <LandingProductPreview />
        </div>
      </section>

      {/* FLUXO */}
      <section className="px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col gap-10">
          <h2 className="text-center text-2xl font-semibold text-text-primary sm:text-3xl">Como começar</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
            {FLOW_STEPS.map((step, index) => (
              <div key={step.title} className="flex flex-col items-center gap-2 text-center">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <step.icon className="size-[18px]" aria-hidden />
                </div>
                <p className="text-xs font-semibold tracking-wider text-text-secondary/60 uppercase">
                  Passo {index + 1}
                </p>
                <p className="text-sm font-medium text-text-primary">{step.title}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PASSPORT */}
      <section className="border-t border-border bg-surface/40 px-6 py-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <IdCard className="size-[18px]" aria-hidden />
          </div>
          <h2 className="text-2xl font-semibold text-text-primary sm:text-3xl">Compartilhe sua coleção</h2>
          <p className="max-w-md text-sm text-text-secondary">
            Se você decidir ativar, o Numora Passport gera um resumo público da sua coleção — moedas, países e
            período — em um link só seu. Você decide se ativa, e pode desativar quando quiser.
          </p>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="px-6 py-20">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
          <h2 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            Comece a organizar sua coleção hoje.
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className={CTA_PRIMARY_CLASSES}>
              Começar minha coleção
            </Link>
            <Link href="/login" className={CTA_SECONDARY_CLASSES}>
              Já tenho uma conta
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
