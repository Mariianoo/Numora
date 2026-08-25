/**
 * app/terms/page.tsx
 * Termos de Uso — Beta Fechado. Server Component estático, mesmo padrão
 * de app/privacy/page.tsx. Rota pública, fora de /dashboard.
 *
 * Conteúdo baseado exclusivamente em auditoria read-only do código e do
 * Supabase (Etapa "Páginas Legais do Beta Fechado") — nenhuma prática não
 * existente é mencionada. Não menciona Stripe/pagamentos como tratamento
 * atual.
 */
import Link from 'next/link'

import { Card } from '@/components/ui/Card'

export const metadata = {
  title: 'Termos de Uso — Numora',
}

export default function TermsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-accent">
          ← Voltar para o início
        </Link>
      </div>

      <div>
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">Numora — Beta Fechado</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-primary">Termos de Uso</h1>
        <p className="mt-3 text-sm text-text-secondary">
          Ao usar o Numora nesta fase, você entende que está participando de um teste de um produto em
          desenvolvimento, ainda pré-operacional.
        </p>
      </div>

      <Card className="p-8">
        <div className="flex flex-col gap-7 text-sm leading-relaxed text-text-secondary">
          <section>
            <h2 className="text-lg font-semibold text-text-primary">1. Aceitação</h2>
            <p className="mt-2">
              Ao criar uma conta no Numora, você concorda com estes Termos de Uso e com nossa{' '}
              <Link href="/privacy" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Privacidade
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">2. O que é o Beta Fechado</h2>
            <p className="mt-2">
              O Numora está em fase de testes, antes do lançamento comercial. Isso significa que:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Funcionalidades podem ser alteradas, adicionadas ou removidas sem aviso prévio.</li>
              <li>O produto pode apresentar instabilidades, erros ou indisponibilidades temporárias.</li>
              <li>Não há, nesta fase, nenhum compromisso de disponibilidade contínua do serviço.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">3. Quem pode usar o Numora</h2>
            <p className="mt-2">
              O Numora é destinado a maiores de 18 anos. Ao criar uma conta, você declara ter essa idade mínima.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">4. Sua conta</h2>
            <p className="mt-2">
              Você é responsável por manter a confidencialidade da sua senha e por todas as atividades realizadas
              na sua conta. Informe imediatamente{' '}
              <a
                href="mailto:suporte.numora@gmail.com"
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                suporte.numora@gmail.com
              </a>{' '}
              se suspeitar de uso não autorizado da sua conta.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">5. Uso aceitável</h2>
            <p className="mt-2">
              Você concorda em não usar o Numora para: praticar atividades ilegais; tentar acessar dados de outros
              usuários sem autorização; tentar comprometer a segurança ou o funcionamento da plataforma; ou
              cadastrar conteúdo (incluindo fotos) que você não tenha o direito de usar.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">6. Seu conteúdo</h2>
            <p className="mt-2">
              Os dados e fotos que você cadastra na sua coleção continuam sendo seus. Ao usá-los no Numora, você
              nos autoriza a armazená-los e exibi-los de volta para você — e, caso você ative o Numora Passport, a
              exibir publicamente as informações que essa funcionalidade mostra (ver{' '}
              <Link href="/privacy" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Privacidade
              </Link>
              , seção 7).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">7. Disponibilidade do serviço</h2>
            <p className="mt-2">
              Por ser um produto em fase de testes, não garantimos disponibilidade ininterrupta, ausência de erros,
              ou preservação de funcionalidades específicas durante o Beta Fechado.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">8. Encerramento da sua conta</h2>
            <p className="mt-2">
              Você pode excluir sua conta a qualquer momento, diretamente pelo produto (/dashboard/profile). A
              exclusão é permanente e remove todos os seus dados, conforme descrito na{' '}
              <Link href="/privacy" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Privacidade
              </Link>
              .
            </p>
            <p className="mt-2">Podemos suspender ou encerrar contas que violem estes Termos.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">9. Limitação de responsabilidade</h2>
            <p className="mt-2">
              O Numora é oferecido &quot;como está&quot; durante o Beta Fechado, sem garantias de qualquer
              natureza. Na máxima extensão permitida por lei, não nos responsabilizamos por perdas decorrentes de
              indisponibilidade, erro ou perda de dados durante esta fase de testes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">10. Propriedade intelectual</h2>
            <p className="mt-2">
              O software, design e marca do Numora pertencem ao responsável pelo projeto. Nada nestes Termos
              transfere a você qualquer direito sobre eles, além do uso do produto conforme aqui descrito.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">11. Alterações a estes Termos</h2>
            <p className="mt-2">
              Podemos atualizar estes Termos conforme o Numora evolui. Mudanças relevantes serão comunicadas dentro
              do produto.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">12. Legislação aplicável</h2>
            <p className="mt-2">Estes Termos são regidos pelas leis brasileiras.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">13. Contato</h2>
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
