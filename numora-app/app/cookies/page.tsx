/**
 * app/cookies/page.tsx
 * Política de Cookies — Beta Fechado. Server Component estático, mesmo
 * padrão de app/privacy/page.tsx e app/terms/page.tsx. Rota pública, fora
 * de /dashboard.
 *
 * Conteúdo descreve exatamente o comportamento implementado em
 * lib/analytics/consent.ts, gtm.ts, attribution.ts e
 * components/analytics/ConsentBanner.tsx/ConsentPreferencesModal.tsx —
 * nenhuma categoria ou cookie além dos que existem de fato no código.
 */
import { Card } from '@/components/ui/Card'
import Link from 'next/link'

export const metadata = {
  title: 'Política de Cookies — Numora',
}

export default function CookiesPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-accent">
          ← Voltar para o início
        </Link>
      </div>

      <div>
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">Numora — Beta Fechado</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-primary">Política de Cookies</h1>
        <p className="mt-3 text-sm text-text-secondary">
          Usamos cookies de forma minimalista, sempre pedindo sua permissão antes de qualquer coisa que não seja
          estritamente necessária para o produto funcionar.
        </p>
      </div>

      <Card className="p-8">
        <div className="flex flex-col gap-7 text-sm leading-relaxed text-text-secondary">
          <section>
            <h2 className="text-lg font-semibold text-text-primary">1. O que são cookies</h2>
            <p className="mt-2">
              Cookies são pequenos arquivos guardados no seu navegador, usados para lembrar informações entre
              visitas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">2. Cookie estritamente necessário</h2>
            <p className="mt-2">
              Usamos um cookie de sessão (gerado pela Supabase, nosso provedor de autenticação) para manter você
              conectado depois do login. Ele é indispensável para o produto funcionar e não depende do seu
              consentimento, assim como não é usado para nenhuma finalidade além de manter sua sessão ativa.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">
              3. Cookies de analytics (opcionais, desligados por padrão)
            </h2>
            <p className="mt-2">
              Se você autorizar, usamos o Google Tag Manager para entender como o Numora é usado — por exemplo,
              quando o painel é aberto, quando uma moeda é adicionada, ou quando alguém abre pela primeira vez.
              Esses eventos nunca incluem seu nome, e-mail, valores financeiros ou conteúdo específico da sua
              coleção.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">
              4. Cookies de marketing/atribuição (opcionais, desligados por padrão)
            </h2>
            <p className="mt-2">
              Se você autorizar, guardamos por 90 dias um cookie (<code>numora_attribution</code>) que registra de
              onde veio seu cadastro — por exemplo, um parâmetro de campanha (UTM), a página pela qual você entrou,
              e o domínio do site de onde você veio (nunca o link completo). Isso nos ajuda a entender quais canais
              de divulgação funcionam, e nunca é enviado ao Google ou a qualquer outro terceiro.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">5. Como gerenciar suas preferências</h2>
            <p className="mt-2">
              Na sua primeira visita, mostramos um banner onde você escolhe aceitar tudo, recusar tudo, ou
              gerenciar cada categoria separadamente. Você pode mudar de ideia a qualquer momento em
              /dashboard/profile. Se você desligar uma categoria que estava ativa, recarregamos a página para
              garantir que nenhum script daquela categoria continue rodando.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">6. Alterações a esta política</h2>
            <p className="mt-2">
              Podemos atualizar esta política conforme o Numora evolui. Mudanças relevantes serão comunicadas
              dentro do produto.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">7. Contato</h2>
            <p className="mt-2">
              <a
                href="mailto:suporte.numora@gmail.com"
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                suporte.numora@gmail.com
              </a>
              , com Thiago Santana Mariano, responsável pelo projeto Numora.
            </p>
          </section>
        </div>
      </Card>
    </div>
  )
}
