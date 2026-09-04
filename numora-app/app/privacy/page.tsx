/**
 * app/privacy/page.tsx
 * Política de Privacidade — Beta Fechado. Server Component estático
 * (sem sessão, sem interatividade), mesmo padrão de app/passport/[username]/page.tsx.
 * Rota pública, fora de /dashboard — não passa pelo matcher do proxy.ts.
 *
 * Conteúdo baseado exclusivamente em auditoria read-only do código e do
 * Supabase (Etapa "Páginas Legais do Beta Fechado") — nenhum tratamento,
 * serviço ou prática é mencionado sem existir de fato hoje. Não menciona
 * Stripe/pagamentos como tratamento atual (schema existe, mas Stripe não
 * está integrado).
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
              <strong className="text-text-primary">Dados financeiros pessoais</strong>: valores que você mesmo
              registra sobre suas próprias compras e vendas de moedas (quanto pagou, quanto vendeu, custo por
              exemplar), e informações de contato de vendedores/compradores que você digitar livremente. Isto não
              é um sistema de pagamento — é um registro pessoal da sua coleção, feito por você, para você.
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
              Não coletamos localização geográfica precisa (GPS/IP), documentos de identidade, dados de pagamento
              (cartão, conta bancária) ou dados biométricos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">3. Por que usamos esses dados</h2>
            <p className="mt-2">
              <strong className="text-text-primary">Identidade e perfil</strong>: para criar e operar sua conta, e
              para exibir seu perfil corretamente dentro do produto.
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Dados da coleção, fotos e dados financeiros pessoais</strong>:
              para oferecer a funcionalidade central do Numora — organizar e exibir sua coleção para você.
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
            <h2 className="text-lg font-semibold text-text-primary">4. Onde seus dados ficam armazenados</h2>
            <p className="mt-2">
              Todos os dados descritos acima são armazenados em infraestrutura da Supabase (banco de dados,
              autenticação e armazenamento de arquivos). As fotos originais ficam em um espaço de armazenamento
              privado, nunca acessível publicamente — o acesso é sempre feito através de links temporários e de
              curta duração, gerados só para você.
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
              5. Hospedagem, processamento e transferência de dados
            </h2>
            <p className="mt-2">
              O banco de dados, a autenticação e o armazenamento de arquivos do Numora (descritos na seção 4) são
              operados pela Supabase em um data center localizado em São Paulo, Brasil. É lá que seus dados
              pessoais, sua coleção, suas fotos e os demais dados descritos na seção 2 ficam armazenados e são
              processados.
            </p>
            <p className="mt-2">
              A aplicação em si é hospedada pela Vercel, que opera por meio de uma rede de infraestrutura global —
              isso pode envolver processamento fora do Brasil, a depender de como a Vercel distribui essa
              infraestrutura. O mesmo vale para o Google Tag Manager, usado apenas quando você consente com
              cookies de analytics (seção 6): por ser uma empresa global, a Google pode processar esses eventos
              fora do Brasil.
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
            <h2 className="text-lg font-semibold text-text-primary">6. Com quem compartilhamos dados</h2>
            <p className="mt-2">
              <strong className="text-text-primary">Supabase</strong> e <strong className="text-text-primary">Vercel</strong>:
              como provedores de infraestrutura que operam o produto (hospedagem, banco de dados, autenticação,
              armazenamento de arquivos).
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Google Tag Manager</strong>: só se você consentir com cookies
              de analytics (ver nossa{' '}
              <Link href="/cookies" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Cookies
              </Link>
              ). Recebe apenas eventos de uso da interface (ex.: visualização do painel, moeda adicionada) — nunca
              dados pessoais, nunca valores financeiros, nunca conteúdo da sua coleção.
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
            <h2 className="text-lg font-semibold text-text-primary">7. Cookies</h2>
            <p className="mt-2">
              O Numora usa cookies para manter sua sessão de login (sempre necessário) e, só com seu consentimento
              explícito, para analytics e atribuição de origem. Detalhes completos na nossa{' '}
              <Link href="/cookies" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                Política de Cookies
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">
              8. Perfil público opcional (Numora Passport)
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
              versão com marca d&apos;água descrita na seção 4, nunca a foto original.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">9. Segurança</h2>
            <p className="mt-2">
              Cada conta só tem acesso aos próprios dados — isso é garantido diretamente no banco de dados (Row
              Level Security), não apenas na interface. Fotos são acessadas exclusivamente por links temporários
              gerados sob demanda.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">10. Por quanto tempo mantemos seus dados</h2>
            <p className="mt-2">
              Mantemos seus dados enquanto sua conta existir. Se você excluir sua conta, seus dados são removidos
              permanentemente (ver seção 12).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">11. Seus direitos</h2>
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
              <li>Excluir sua conta e todos os seus dados, de forma definitiva (ver seção 12).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">12. Exclusão de conta</h2>
            <p className="mt-2">
              O Numora oferece exclusão de conta self-service, disponível em /dashboard/profile, na seção
              &quot;Zona de perigo&quot;. Ao confirmar a exclusão:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Todas as suas fotos são removidas do armazenamento.</li>
              <li>
                Seu perfil, coleção, exemplares, fotos, compras, vendas e dados de atribuição são apagados
                permanentemente do banco de dados.
              </li>
              <li>Sua conta de acesso é removida.</li>
            </ul>
            <p className="mt-2">
              <strong className="text-text-primary">Essa ação é irreversível.</strong> Uma única exceção: se você
              já realizou uma ação administrativa ou concedeu um benefício a outro usuário, esse registro histórico
              específico é mantido (sem o seu nome vinculado) — apenas para preservar a integridade de auditoria da
              plataforma, nunca para manter dado pessoal seu.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">13. Crianças e adolescentes</h2>
            <p className="mt-2">
              O Numora não é direcionado a menores de 18 anos. Se tomarmos conhecimento de que coletamos dados de
              um menor sem o devido consentimento dos responsáveis, excluiremos esses dados mediante solicitação.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">14. Alterações a esta política</h2>
            <p className="mt-2">
              Podemos atualizar esta política conforme o Numora evolui, especialmente ao sair do Beta Fechado.
              Mudanças relevantes serão comunicadas dentro do produto.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">15. Contato</h2>
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
