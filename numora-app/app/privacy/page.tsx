/**
 * app/privacy/page.tsx
 * Política de Privacidade — Beta Fechado. Server Component estático
 * (sem sessão, sem interatividade), mesmo padrão de app/passport/[username]/page.tsx.
 * Rota pública, fora de /dashboard — não passa pelo matcher do proxy.ts.
 *
 * Conteúdo baseado exclusivamente em auditoria read-only do código e do
 * Supabase (Etapa "Páginas Legais do Beta Fechado") — nenhum tratamento,
 * serviço ou prática é mencionado sem existir de fato hoje.
 *
 * Etapa "5.9I — Privacy & Cookies Policy Update": corrige a afirmação
 * anterior de que o Numora "não é um sistema de pagamento" — falsa desde
 * a integração do Stripe (Etapas Stripe 5.x). Adiciona as seções 3
 * ("Pagamentos e assinaturas") e 11 ("Monitoramento de erros"), e ajusta
 * §2/§4/§5/§6/§7/§8/§12/§14 para refletir o comportamento real hoje —
 * nunca inventa prazo/base legal/localização que o código não comprove
 * (auditorias 5.9F/5.9H/5.9I); pontos não determináveis tecnicamente usam
 * a mesma linguagem de "em avaliação" já usada por este documento antes
 * desta etapa (ver §3/§6), nunca uma afirmação de conformidade jurídica
 * definitiva.
 */
import Link from 'next/link'

import { Card } from '@/components/ui/Card'

export const metadata = {
  title: 'Política de Privacidade — Numora',
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-accent">
          ← Voltar para o início
        </Link>
      </div>

      <div>
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">Numora — Beta Fechado</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-primary">Política de Privacidade</h1>
        <p className="mt-3 text-sm text-text-secondary">
          O Numora está em Beta Fechado — fase de testes, pré-operacional. Esta política descreve como tratamos
          dados nesta fase. Ela pode ser atualizada conforme o produto evolui rumo ao lançamento comercial.
        </p>
      </div>

      <Card className="p-8">
        <div className="flex flex-col gap-7 text-sm leading-relaxed text-text-secondary">
          <section>
            <h2 className="text-lg font-semibold text-text-primary">1. Quem é o controlador dos seus dados</h2>
            <p className="mt-2">
              O Numora é um projeto em fase de testes. O controlador dos dados tratados por este produto é{' '}
              <strong className="text-text-primary">Thiago Santana Mariano</strong>, responsável pelo projeto
              Numora. Não existe, nesta fase, uma pessoa jurídica formalmente constituída para o Numora.
            </p>
            <p className="mt-2">
              Para qualquer solicitação relacionada aos seus dados pessoais, entre em contato:{' '}
              <a
                href="mailto:suporte.numora@gmail.com"
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                suporte.numora@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">2. Quais dados coletamos</h2>
            <p className="mt-2">
              <strong className="text-text-primary">Dados de identidade e acesso</strong>: nome, e-mail e senha
              (armazenada de forma criptografada — nunca em texto legível, nem para nós).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados de perfil</strong>: nome de usuário (username), foto de
              perfil (se você adicionar uma), país, data de início como colecionador, e um identificador público
              gerado automaticamente (Numora ID).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados da sua coleção</strong>: as informações que você cadastra
              sobre suas moedas e exemplares — país, ano, denominação, metal, peso, pureza, grau de conservação,
              valor de face, quantidade, descrição, localização física (campo opcional, de uso livre), etiquetas,
              quantidade cunhada, histórico e curiosidades que você registrar, e referências de catálogo.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados financeiros pessoais da sua coleção</strong>: valores que
              você mesmo registra sobre suas próprias compras e vendas de moedas (quanto pagou, quanto vendeu,
              custo por exemplar), e informações de contato de vendedores/compradores que você digitar livremente.
              Isso é um registro pessoal da sua coleção, feito por você, para você — não tem relação com o
              pagamento da sua assinatura do Numora, tratado separadamente (ver seção 3, &quot;Pagamentos e
              assinaturas&quot;).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados de pagamento e assinatura</strong>: se você assina um
              plano pago (Pro/Premium), tratamos os dados necessários para processar e gerenciar essa assinatura,
              através do nosso processador de pagamentos (Stripe) — ver seção 3 para detalhes.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Fotos</strong>: até três fotos por exemplar (frente, verso e
              borda), quando você optar por adicioná-las.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados de atribuição de origem</strong> (só se você consentir
              com cookies de marketing): de onde veio o seu cadastro (ex.: um link de campanha, uma busca no
              Google, acesso direto), a página pela qual você entrou e o site de onde você veio (só o nome do
              domínio, nunca o link completo).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados administrativos</strong>: se você exercer um papel
              administrativo no Numora, registramos as ações administrativas realizadas, para fins de auditoria
              interna.
            </p>
            <p className="mt-2">
              Não coletamos localização geográfica precisa (GPS/IP), documentos de identidade, ou dados
              biométricos. Não armazenamos o número completo do seu cartão de crédito ou dados de conta bancária em
              nossos próprios sistemas — quando você assina um plano pago, esses dados são tratados diretamente
              pelo nosso processador de pagamentos (Stripe), nunca por nós (ver seção 3).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">3. Pagamentos e assinaturas (Stripe)</h2>
            <p className="mt-2">
              Para planos pagos (Pro/Premium), o Numora utiliza a Stripe, uma processadora de pagamentos
              terceirizada, para processar cobranças e gerenciar assinaturas.
            </p>
            <p className="mt-2">
              O Stripe trata, em nosso nome, os dados necessários para viabilizar a contratação, cobrança,
              renovação e gestão do seu plano — isso inclui seu e-mail e os dados de pagamento que você fornece
              diretamente na página de pagamento hospedada pelo próprio Stripe (ex.: dados do cartão). O Numora não
              recebe, não armazena e não tem acesso ao número completo do seu cartão ou a outros dados sensíveis de
              pagamento — eles vão diretamente ao Stripe, nunca passam pelos nossos servidores.
            </p>
            <p className="mt-2">
              Em nossos próprios sistemas, mantemos só referências técnicas necessárias para operar sua assinatura
              — por exemplo, um identificador do seu cliente no Stripe, o status da sua assinatura (ativa,
              cancelada, etc.), o plano contratado, e um histórico resumido de cobranças (valor, data, status) para
              fins de exibição e suporte. Nenhum dado da sua coleção é compartilhado com o Stripe.
            </p>
            <p className="mt-2">
              O Stripe é uma empresa global e pode processar esses dados fora do Brasil (ver seção 6). Os detalhes
              exatos de base legal e localização específica dessa transferência ainda estão em avaliação junto ao
              fornecedor e podem ser detalhados com mais precisão em uma atualização futura desta política.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">4. Por que usamos esses dados</h2>
            <p className="mt-2">
              <strong className="text-text-primary">Identidade e perfil</strong>: para criar e operar sua conta, e
              para exibir seu perfil corretamente dentro do produto.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados da coleção, fotos e dados financeiros pessoais</strong>:
              para oferecer a funcionalidade central do Numora — organizar e exibir sua coleção para você.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados de pagamento e assinatura</strong>: para processar a
              contratação, cobrança, renovação e gestão do seu plano pago, através do nosso processador de
              pagamentos (Stripe).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados de atribuição</strong>: só quando você consente, para
              entendermos de onde vêm nossos usuários (nunca é usado para decidir o que você vê no produto).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados administrativos</strong>: só para papéis administrativos,
              para manter um histórico confiável de ações realizadas na plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">5. Onde seus dados ficam armazenados</h2>
            <p className="mt-2">
              Todos os dados descritos na seção 2 (com exceção dos dados de pagamento propriamente ditos, ver
              abaixo) são armazenados em infraestrutura da Supabase (banco de dados, autenticação e armazenamento
              de arquivos). As fotos originais ficam em um espaço de armazenamento privado, nunca acessível
              publicamente — o acesso é sempre feito através de links temporários e de curta duração, gerados só
              para você.
            </p>
            <p className="mt-2">
              As referências técnicas da sua assinatura (status, plano, identificador do cliente no Stripe,
              histórico resumido de cobranças) também ficam armazenadas na infraestrutura da Supabase. Os dados de
              pagamento propriamente ditos (como o número do seu cartão) nunca chegam a essa infraestrutura — ficam
              exclusivamente com o Stripe (ver seção 3).
            </p>
            <p className="mt-2">
              Se você optar por publicar a foto de uma moeda no seu Numora Passport, geramos uma versão separada
              dessa foto, especificamente para exibição pública: removemos metadados técnicos do arquivo (como
              informações de localização/GPS e outros dados EXIF da câmera) e adicionamos a marca d&apos;água
              &quot;Numora Collect&quot;. A foto original, sem marca d&apos;água, nunca é publicada — continua no
              armazenamento privado.
            </p>
            <p className="mt-2">A aplicação em si é hospedada pela Vercel.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">
              6. Hospedagem, processamento e transferência de dados
            </h2>
            <p className="mt-2">
              O banco de dados, a autenticação e o armazenamento de arquivos do Numora (descritos na seção 5) são
              operados pela Supabase em um data center localizado em São Paulo, Brasil. É lá que seus dados
              pessoais, sua coleção, suas fotos e os demais dados descritos na seção 2 ficam armazenados e são
              processados.
            </p>
            <p className="mt-2">
              A aplicação em si é hospedada pela Vercel, que opera por meio de uma rede de infraestrutura global —
              isso pode envolver processamento fora do Brasil, a depender de como a Vercel distribui essa
              infraestrutura. O mesmo vale para o Stripe (processamento de pagamentos, seção 3) e para o Google Tag
              Manager, usado apenas quando você consente com cookies de analytics (seção 7): por serem empresas
              globais, esses fornecedores podem processar dados fora do Brasil.
            </p>
            <p className="mt-2">
              Quando isso ocorre, essa transferência internacional acontece só na medida necessária para operar o
              Numora através desses fornecedores, e permanece sujeita às exigências aplicáveis da Lei Geral de
              Proteção de Dados (LGPD) para esse tipo de transferência. Este é um ponto que segue em avaliação
              junto aos nossos fornecedores e pode ser detalhado com mais precisão em uma atualização futura desta
              política.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">7. Com quem compartilhamos dados</h2>
            <p className="mt-2">
              <strong className="text-text-primary">Supabase</strong> e <strong className="text-text-primary">Vercel</strong>:
              como provedores de infraestrutura que operam o produto (hospedagem, banco de dados, autenticação,
              armazenamento de arquivos).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Stripe</strong>: como processador de pagamentos, para planos
              pagos (Pro/Premium) — ver seção 3 para o que exatamente é compartilhado.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Google Tag Manager</strong>: só se você consentir com cookies
              de analytics (ver nossa{' '}
              <Link href="/cookies" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Cookies
              </Link>
              ). Recebe apenas eventos de uso da interface (ex.: visualização do painel, moeda adicionada,
              interação com o processo de upgrade de plano) — nunca dados pessoais, nunca valores financeiros,
              nunca conteúdo da sua coleção. Separadamente, o Numora também pode registrar, de forma interna e só
              em nossos próprios sistemas, um evento técnico indicando que uma assinatura foi concluída com
              sucesso — esse registro é usado só para métricas internas do produto e nunca é enviado ao Google ou a
              qualquer outro terceiro.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Sentry</strong>: como ferramenta de monitoramento de erros
              técnicos — ver seção 11.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">E-mail transacional</strong>: para enviar e-mails de
              confirmação de cadastro e redefinição de senha, utilizamos a infraestrutura de e-mail da Supabase.
              Estamos em processo de migração para um provedor de e-mail dedicado (Resend), hoje em uso apenas em
              nosso ambiente interno de testes, ainda não em produção.
            </p>
            <p className="mt-2">
              Não vendemos, alugamos ou compartilhamos seus dados com terceiros para fins de publicidade.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">8. Cookies</h2>
            <p className="mt-2">
              O Numora usa cookies para manter sua sessão de login (sempre necessário) e, só com seu consentimento
              explícito, para analytics, atribuição de origem, e métricas relacionadas à jornada de contratação de
              planos. Detalhes completos na nossa{' '}
              <Link href="/cookies" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Cookies
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">
              9. Perfil público opcional (Numora Passport)
            </h2>
            <p className="mt-2">
              Você pode, se quiser, ativar um perfil público (&quot;Numora Passport&quot;) que exibe seu nome,
              username, país, data de início como colecionador e estatísticas agregadas da sua coleção (quantas
              moedas, quantos países, quantos metais, período). Essa ativação é opcional, desligada por padrão, e
              você pode desativá-la a qualquer momento. O Passport nunca exibe seu e-mail, valores financeiros ou
              dados internos.
            </p>
            <p className="mt-2">
              A publicação de fotos de moedas específicas é uma decisão separada e explícita, feita moeda por
              moeda — nunca acontece automaticamente junto com a ativação do Passport. Fotos publicadas exibem a
              versão com marca d&apos;água descrita na seção 5, nunca a foto original.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">10. Segurança</h2>
            <p className="mt-2">
              Cada conta só tem acesso aos próprios dados — isso é garantido diretamente no banco de dados (Row
              Level Security), não apenas na interface. Fotos são acessadas exclusivamente por links temporários
              gerados sob demanda.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">11. Monitoramento de erros</h2>
            <p className="mt-2">
              Usamos a Sentry como ferramenta de monitoramento de erros técnicos, para identificar e corrigir
              falhas no funcionamento do Numora. Ela pode receber informações técnicas sobre o erro ocorrido —
              incluindo, em alguns casos, identificadores técnicos internos (por exemplo, uma referência a uma
              sessão de pagamento no Stripe) — mas nossa configuração remove automaticamente senhas, tokens de
              acesso e cookies de sessão antes de qualquer envio.
            </p>
            <p className="mt-2">
              A Sentry não é usada para analytics de produto, nem para decidir qualquer coisa sobre a sua conta —
              é exclusivamente uma ferramenta de diagnóstico técnico, separada dos eventos descritos na{' '}
              <Link href="/cookies" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Cookies
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">12. Por quanto tempo mantemos seus dados</h2>
            <p className="mt-2">
              Mantemos seus dados enquanto sua conta existir. Se você excluir sua conta, seus dados pessoais são
              removidos permanentemente dos nossos sistemas (ver seção 14) — com uma exceção: dados que o Stripe,
              como nosso processador de pagamentos, mantenha sob sua própria política de retenção (por exemplo,
              para fins contábeis/fiscais) não estão sob nosso controle direto e podem continuar existindo lá.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">13. Seus direitos</h2>
            <p className="mt-2">Você pode, a qualquer momento:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Acessar e corrigir seus dados de perfil, diretamente em /dashboard/profile.</li>
              <li>
                Solicitar informações sobre quais dados temos sobre você, escrevendo para{' '}
                <a
                  href="mailto:suporte.numora@gmail.com"
                  className="text-accent underline underline-offset-2 hover:text-accent-hover"
                >
                  suporte.numora@gmail.com
                </a>
                .
              </li>
              <li>Excluir sua conta e todos os seus dados, de forma definitiva (ver seção 14).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">14. Exclusão de conta</h2>
            <p className="mt-2">
              O Numora oferece exclusão de conta self-service, disponível em /dashboard/profile, na seção
              &quot;Zona de perigo&quot;. Ao confirmar a exclusão:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Se você tiver uma assinatura paga ativa, ela é cancelada no Stripe antes de qualquer outro passo.</li>
              <li>Todas as suas fotos são removidas do armazenamento.</li>
              <li>
                Seu perfil, coleção, exemplares, fotos, compras, vendas, dados de atribuição, e as referências
                técnicas da sua assinatura (status, plano, histórico de cobranças mantido em nossos sistemas) são
                apagados permanentemente do nosso banco de dados.
              </li>
              <li>Sua conta de acesso é removida.</li>
            </ul>
            <p className="mt-2">
              <strong className="text-text-primary">Essa ação é irreversível nos nossos próprios sistemas.</strong>{' '}
              Duas exceções:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Se você já realizou uma ação administrativa ou concedeu um benefício a outro usuário, esse registro
                histórico específico é mantido (sem o seu nome vinculado) — apenas para preservar a integridade de
                auditoria da plataforma, nunca para manter dado pessoal seu.
              </li>
              <li>
                O histórico da sua assinatura pode continuar existindo nos sistemas do Stripe, nosso processador de
                pagamentos, sujeito à política de retenção própria dele (tipicamente exigida para fins
                contábeis/fiscais) — não temos controle direto sobre isso.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">15. Crianças e adolescentes</h2>
            <p className="mt-2">
              O Numora não é direcionado a menores de 18 anos. Se tomarmos conhecimento de que coletamos dados de
              um menor sem o devido consentimento dos responsáveis, excluiremos esses dados mediante solicitação.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">16. Alterações a esta política</h2>
            <p className="mt-2">
              Podemos atualizar esta política conforme o Numora evolui, especialmente ao sair do Beta Fechado.
              Mudanças relevantes serão comunicadas dentro do produto.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">17. Contato</h2>
            <p className="mt-2">
              Dúvidas sobre esta política ou sobre seus dados:{' '}
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
