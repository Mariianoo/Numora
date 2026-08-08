# BUSINESS_MODEL.md — Numora

> **Papel deste documento:** modelo de negócio completo do Numora (anteriormente referido nas conversas como Numisphere/CoinVerse — mesmo produto). Subordinado a `PROJECT_RULES.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API_SPEC.yaml`, `PRODUCT_BIBLE.md`, `UX_BIBLE.md`, `FEATURE_CATALOG.md`, `USER_STORIES.md` e `SYSTEM_ARCHITECTURE.md` — nenhum documento anterior é alterado. Onde os documentos técnicos definem **o que o produto faz e como funciona**, este documento define **por que o negócio existe, para quem, e como sustenta a si mesmo financeiramente**.
> **Para quem é:** liderança executiva, investidores, e qualquer pessoa da equipe que precise entender a lógica comercial por trás das decisões de produto já especificadas.

---

## 1. Missão

Dar a qualquer colecionador de moedas, cédulas, medalhas e tokens um lugar único, confiável e sempre acessível para catalogar, entender e valorizar sua coleção — e conectar-se com outros colecionadores de forma segura. (Mesma missão de produto de `PRODUCT_BIBLE.md` §1.1, reafirmada aqui como missão de negócio: o produto e o negócio existem pela mesma razão.)

## 2. Visão

Ser, em cinco anos, a referência global de catalogação numismática digital — o lugar onde a maior parte do valor documentado de coleções privadas do mundo está registrado, protegido e, quando o colecionador desejar, conectado a um mercado confiável de compra, venda e troca. Sucesso é medido não pelo tempo de tela gerado, mas pela quantidade de acervos que existiriam de forma menos organizada, menos segura e menos valorizada sem o Numora.

## 3. Valores

- **Confiança acima de crescimento.** Nenhuma decisão de monetização compromete a integridade do dado do usuário (`PROJECT_RULES.md` §1.6 — segurança e consistência de dados vêm antes de performance, experiência e velocidade de entrega).
- **Transparência com o colecionador.** Estimativas de IA, comissões de marketplace e limites de plano são sempre comunicados de forma clara e antecipada — nunca como surpresa (`PRODUCT_BIBLE.md` RN-06, RN-09).
- **O acervo é do usuário, sempre.** Exportação de dados, portabilidade e propriedade plena do que foi catalogado nunca são reféns de um plano pago (`PROJECT_RULES.md` §41.3 — LGPD).
- **Comunidade a serviço do colecionismo, não o contrário.** Recursos sociais (ranking, gamificação) existem para enriquecer a experiência de colecionar, nunca para maximizar engajamento às custas do bem-estar do usuário (`UX_BIBLE.md` §1).
- **Crescimento sustentável.** Preferência por unit economics saudável (seções 24–27) a crescimento subsidiado insustentável.

## 4. Posicionamento

> "O Numora é o cofre digital, a enciclopédia e a comunidade do colecionador de numismática — o único lugar que trata sua coleção com o mesmo cuidado que um museu trata um acervo, mas cabe no seu bolso."

Posicionado entre três categorias adjacentes, sem pertencer inteiramente a nenhuma:
- **Não é** um app de inventário genérico (tipo planilha/organizador) — tem profundidade de domínio (catálogo mestre, grading, IA especializada).
- **Não é** uma casa de leilões/marketplace puro (tipo plataforma de classificados) — o core é a catalogação pessoal, o marketplace é uma camada opcional.
- **Não é** uma rede social genérica — comunidade é funcionalidade de suporte ao colecionismo, não o produto em si (`PRODUCT_BIBLE.md` §1.3).

## 5. Público-alvo

Ver `PRODUCT_BIBLE.md` §1.2 para a tabela completa de segmentos. Em termos de negócio, os segmentos se traduzem em três motores comerciais distintos:
- **Motor de volume (aquisição):** iniciantes e hobbistas — maior volume, menor ticket médio, principal fonte de dados de catálogo e de efeito de rede.
- **Motor de receita (monetização direta):** investidores e lojistas — maior propensão a pagar por Premium/Pro, maior LTV individual.
- **Motor de retenção (comunidade):** colecionadores sociais — maior engajamento recorrente, menor propensão a churn, amplificam aquisição via indicação.

## 6. Personas

Personas completas em `PRODUCT_BIBLE.md` §1.4 (Marcos, Renata, Eduardo, Camila, Bruno). Em termos de negócio:

| Persona | Papel comercial primário | Plano provável |
|---|---|---|
| Marcos, o Iniciante | Aquisição/topo de funil, potencial de conversão futura | `free` → `premium` |
| Renata, a Hobbista | Retenção de longo prazo, baixo churn | `free`/`premium` |
| Eduardo, o Investidor | Receita direta de alto ticket | `premium`/`pro` |
| Camila, a Lojista | Receita de marketplace (comissão) + assinatura | `pro` + vendedora verificada |
| Bruno, o Social | Retenção via comunidade, motor de indicação | `free`/`premium` |

## 7. Mercado

O numismatismo é um hobby de longa cauda, geograficamente distribuído e historicamente mal servido por ferramentas digitais nativas — a maior parte do mercado hoje usa planilhas, cadernos físicos ou fóruns fragmentados. O tamanho do mercado endereçável combina: (a) colecionadores ativos organizados em clubes/federações nacionais e internacionais, (b) um número muito maior de colecionadores "não-organizados" (herdeiros de coleções, colecionadores casuais) sem ferramenta dedicada, e (c) o mercado adjacente de comércio numismático (lojistas, casas de leilão de pequeno/médio porte) que hoje depende de ferramentas genéricas de e-commerce. O Brasil é o mercado de lançamento (alinhado a `PROJECT_RULES.md` §39 — pt-BR como idioma primário), com arquitetura de internacionalização já preparada desde o dia 1 para expansão (seção 21).

## 8. Concorrentes

| Categoria | Exemplos de tipo de concorrente | Lacuna que o Numora explora |
|---|---|---|
| Apps de catalogação genérica (não-numismáticos) | Organizadores de coleção genéricos, planilhas | Falta de profundidade de domínio, sem catálogo mestre nem IA especializada |
| Catálogos numismáticos de referência (sem gestão pessoal) | Bases de dados/enciclopédias online de moedas | Não gerenciam o acervo pessoal do usuário, sem app, sem comunidade |
| Marketplaces genéricos de colecionáveis | Plataformas de classificados/leilão amplas | Sem curadoria de domínio, sem confiança de dado, comissões e experiência não desenhadas para numismática |
| Fóruns e grupos de comunidade (redes sociais genéricas) | Grupos/fóruns dedicados ao hobby | Sem estrutura de dado, sem persistência organizada, sem ferramenta de catalogação |
| Software de grading/avaliação profissional | Serviços de certificação física | Alto custo, alto atrito, não é uma ferramenta de uso diário do colecionador comum |

Nenhum concorrente direto combina catalogação estruturada + IA + comunidade + marketplace opcional em um único produto nativo mobile-first — essa combinação é a aposta central do Numora.

## 9. Diferenciais competitivos

1. **IA de catalogação e avaliação nativa** (`FEATURE_CATALOG.md` módulo IA) — nenhum concorrente direto oferece reconhecimento por foto com o mesmo nível de transparência de confiança.
2. **Offline-first genuíno** — funciona em feiras e exposições sem depender de conexão (`PROJECT_RULES.md` §21), diferencial operacional real para o público que mais gera GMV de marketplace.
3. **Arquitetura de confiança de dado** — RLS, auditoria imutável e separação catálogo/exemplar (`DATABASE.md`) tornam o dado do usuário mais confiável que uma planilha ou app genérico.
4. **Marketplace e trocas nativos ao acervo já catalogado** — vender ou trocar um item não exige recadastrá-lo em outra plataforma.
5. **Design centrado em precisão e calma** (`UX_BIBLE.md` §1) — evita a fadiga de engajamento de produtos sociais genéricos, alinhado ao perfil de um colecionador que valoriza cuidado, não estímulo.

## 10. Modelo Freemium

O plano `free` (`DATABASE.md` — `subscription_tier=free`) é o padrão de todo cadastro (`PRODUCT_BIBLE.md` §2) e é desenhado para ser **genuinamente útil indefinidamente**, não uma demonstração limitada artificialmente:

- Catalogação manual **ilimitada** de itens (a limitação de negócio nunca recai sobre o ato central de guardar a própria coleção — isso contradiria a Missão e os Valores).
- Limite de **cota mensal de análises de IA** (Scanner/Identificação) — o gatilho de conversão mais previsível do produto (`FEATURE_CATALOG.md` AI-006).
- Limite de **número de fotos por item** e ausência de certificados/laudos anexáveis (`FEATURE_CATALOG.md` COL-011).
- Acesso completo a Marketplace, Trocas, Wishlist e Comunidade no plano gratuito — recursos sociais nunca são paywall, pois dependem de rede/volume para funcionar bem (mais usuários gratuitos participando fortalece o marketplace para todos, inclusive para quem paga).

**Lógica de negócio do freemium:** o plano gratuito é o motor de aquisição e de efeito de rede (mais itens catalogados = catálogo mestre mais rico = produto melhor para todos); a conversão paga vem de necessidades que escalam com o tamanho/valor do acervo do próprio usuário — o gatilho de upgrade é sempre proporcional ao valor que o usuário já está obtendo, nunca uma limitação arbitrária de entrada.

## 11. Plano Premium

Público-alvo primário: Renata (Hobbista) e Eduardo (Investidor) em estágio inicial de maturidade de acervo.

**Inclui (acima do `free`):**
- Cota de IA substancialmente maior (Scanner, Identificação, Reanálise).
- Estimativa de valor por IA (`FEATURE_CATALOG.md` AI-002) — recurso central do plano.
- Avaliação de condição assistida por IA (grading — AI-003).
- Certificados/laudos anexáveis por item (COL-011).
- Fotos ilimitadas por item.
- Relatórios de exportação avançados (módulo Exportação, referenciado em `FEATURE_CATALOG.md` — pendente de catalogação em lote futuro).
- Prioridade de suporte.

**Preço:** posicionado como assinatura mensal/anual de baixo atrito (modelo "café por mês"), com desconto no ciclo anual — o valor de ancoragem é sempre comparado ao custo de **não perder ou subavaliar um único item da coleção**, nunca ao custo de outros apps de produtividade genéricos.

## 12. Plano Enterprise (Pro)

Público-alvo primário: Camila (Lojista) e organizações (federações, clubes de colecionadores, pequenas casas numismáticas).

**Inclui (acima do Premium):**
- Selo de **Vendedor Verificado** (`is_verified_seller`) com maior visibilidade no Marketplace.
- Ferramentas de gestão de inventário em lote e exportação/importação avançada (módulos Importação/Exportação).
- MFA obrigatório e recursos de segurança de conta reforçados, adequados a quem administra valor de terceiros.
- Acesso antecipado a recursos preparados como Verificação de Autenticidade por IA (`FEATURE_CATALOG.md` AI-004) quando ativado.
- Limites de marketplace ampliados (mais anúncios simultâneos ativos) e comissão reduzida em volume (seção 14).
- Possível camada B2B futura: contas de organização (múltiplos usuários sob uma mesma entidade — clube/federação), com relatórios agregados — capacidade a especificar em versão futura de `DATABASE.md`/`API_SPEC.yaml`.

**Preço:** modelo híbrido de assinatura mensal mais robusta + comissão de marketplace reduzida em relação ao usuário comum, alinhado ao padrão de "quem vende mais, paga proporcionalmente menos por transação, mas mais por acesso à ferramenta".

## 13. Marketplace

O Marketplace (`FEATURE_CATALOG.md` módulo Marketplace, `DATABASE.md` Módulo F) é uma camada **opcional e nativa** sobre o acervo já catalogado — vender ou comprar não exige recriar dados já existentes na coleção pessoal. Funciona como o principal motor de **efeito de rede e de monetização transacional** do negócio, complementar (não concorrente) à receita de assinatura.

**Papel estratégico:** enquanto Premium/Pro monetizam o valor que o usuário obtém *sozinho* (organização, IA), o Marketplace monetiza o valor que o usuário obtém *da rede* (encontrar comprador/vendedor) — os dois motores de receita crescem de formas diferentes e se reforçam mutuamente (mais itens catalogados → mais oferta no marketplace → mais compradores atraídos → mais itens catalogados por novos usuários).

## 14. Comissão

Estrutura de comissão sobre transações concluídas no Marketplace (`marketplace_transactions` — `DATABASE.md` §3):
- Comissão percentual sobre o valor final da venda, cobrada do vendedor no momento da conclusão da transação (fluxo atômico descrito em `SYSTEM_ARCHITECTURE.md` §7.3).
- Percentual **decrescente por volume/plano**: usuário comum no plano `free`/`premium` paga a taxa padrão; Vendedor Verificado (`pro`) paga taxa reduzida, como benefício de assinatura Enterprise (seção 12).
- Trocas (`Trades`) **não geram comissão** — são, por design, uma alternativa sem fricção monetária ao dinheiro, e servem ao propósito de retenção/comunidade, não de receita direta.
- Transparência total: a comissão é sempre exibida ao vendedor antes da confirmação do anúncio, nunca descontada de forma não-antecipada (alinhado ao Valor de Transparência, seção 3).

## 15. Monetização

Síntese dos motores de receita, em ordem de maturidade esperada:

| Motor | Fase | Descrição |
|---|---|---|
| Assinatura Premium | Desde o lançamento | Receita recorrente previsível, baseada em valor individual (IA, limites, laudos) |
| Comissão de Marketplace | Desde o lançamento, cresce com a base | Receita transacional, cresce com liquidez de rede |
| Assinatura Pro/Enterprise | Curto-médio prazo | Receita recorrente de maior ticket, público comercial |
| Parcerias/dados agregados anonimizados (ex.: tendência de mercado numismático) | Médio-longo prazo | Receita B2B complementar, sempre em conformidade com LGPD (`PROJECT_RULES.md` §41) — nunca venda de dado pessoal identificável |
| Eventos/patrocínio (feiras, parcerias com federações) | Médio-longo prazo | Receita complementar, reforça posicionamento de comunidade |

Nenhum motor de monetização compromete o princípio freemium da seção 10 nem os Valores da seção 3 — a receita nunca vem de venda de dado pessoal, de limitação artificial da catalogação básica, ou de práticas que reduzam a confiança do colecionador no produto.

## 16. Roadmap Comercial

| Fase | Foco comercial |
|---|---|
| Fase 1 — Lançamento (Brasil) | Validar ativação/retenção do freemium; primeiras conversões Premium; marketplace em fase de liquidez inicial (sem comissão reduzida por volume ainda relevante) |
| Fase 2 — Consolidação (Brasil) | Otimizar funil de conversão Premium via gatilho de cota de IA (`AI-006`); lançar Pro/Enterprise para lojistas; primeiras parcerias com clubes/federações nacionais |
| Fase 3 — Expansão regional | Internacionalização para mercados de língua espanhola/inglesa próximos (seção 21); marketplace cross-border preparado |
| Fase 4 — Maturidade | Camada B2B de organizações; parcerias de dados agregados; presença em eventos internacionais de numismática |

Roadmap técnico correlato em `SYSTEM_ARCHITECTURE.md` §40 (pendente de publicação); roadmap de produto (MVP/V1/V2/Enterprise) em `PRODUCT_BIBLE.md`/`FEATURE_CATALOG.md` (seções finais, pendentes de publicação).

## 17. Estratégia de aquisição de usuários

- **Orgânico/comunidade:** presença em fóruns, grupos e federações numismáticas existentes — o público já está organizado em comunidades identificáveis, reduzindo custo de descoberta.
- **Boca a boca estrutural:** o próprio ato de compartilhar uma coleção pública ou convidar para uma troca (`PRODUCT_BIBLE.md` módulos Coleção/Trocas) é um canal de aquisição embutido no produto (viral loop nativo, não campanha paga).
- **Parcerias com feiras e eventos físicos:** presença em feiras de colecionismo (alinhado ao módulo Eventos), onde a demonstração do Scanner IA ao vivo é um gancho de aquisição de altíssima conversão (o "momento aha" de `PRODUCT_BIBLE.md` §1.5 acontece em segundos).
- **Conteúdo educativo:** materiais sobre identificação/grading que atraem buscas de iniciantes (persona Marcos) organicamente.
- **Aquisição paga (fase 2+):** performance marketing direcionado a públicos afins (colecionismo, numismática, investimento alternativo), apenas após unit economics validado (CAC/LTV, seções 24–25).

## 18. Estratégia de retenção

- **Momento aha rápido** (`PRODUCT_BIBLE.md` §1.5) reduz o maior risco de churn, que é o abandono no primeiro dia.
- **Offline-first** (`PROJECT_RULES.md` §21) remove a maior fonte de frustração em uso real de campo, protegendo retenção de usuários de alto engajamento (feiras/eventos).
- **Acervo como histórico de vida:** quanto mais um usuário cataloga, maior o custo de troca percebido para abandonar o produto (lock-in saudável, baseado em valor acumulado genuíno, nunca em dificuldade artificial de exportação — reforça Valor de propriedade do dado, seção 3).
- **Gamificação e comunidade** (seções 19–20) como reforço de hábito recorrente, não como mecanismo manipulativo.
- **Notificações relevantes e não-ruidosas** (`SYSTEM_ARCHITECTURE.md` §10) — wishlist match, oferta recebida — trazem o usuário de volta por motivo genuíno, nunca por notificação vazia.

## 19. Estratégia de gamificação

Gamificação (`FEATURE_CATALOG.md`/`PRODUCT_BIBLE.md` módulos Conquistas/Ranking, pendentes de catalogação em lote futuro) é subordinada ao princípio de "Sábio + Cuidador, nunca Bobo da Corte" (`UX_BIBLE.md` §3):
- Conquistas celebram marcos genuínos de colecionismo (primeira peça de um país, primeira troca concluída, coleção completa de uma série) — nunca métricas de vaidade vazias (tempo de app aberto).
- Ranking é opcional e contextualizado (por categoria/região/tema), nunca uma única tabela global que desmotiva a maioria dos usuários.
- Pontuação nunca é monetizável diretamente (não é uma moeda paga) — preserva a integridade do hobby e evita incentivos perversos (ex.: catalogação fraudulenta para pontos).
- Gamificação é avaliada por sua contribuição à retenção (seção 18), nunca otimizada isoladamente como métrica própria de sucesso.

## 20. Estratégia de comunidade

- Comunidade nasce do próprio grafo de colecionismo (trocas, wishlist compartilhada, coleções públicas) antes de depender de features sociais dedicadas.
- Moderação ativa e confiável (`FEATURE_CATALOG.md` módulo Administração, `PRODUCT_BIBLE.md` módulo Administração pendente) é tratada como investimento de retenção, não custo — um marketplace/comunidade percebido como inseguro perde confiança rapidamente e é difícil de recuperar.
- Eventos físicos e parcerias com federações (seção 17) ancoram a comunidade digital em relações já existentes no mundo real do colecionismo, em vez de tentar criar uma comunidade do zero.
- Reputação (avaliações de marketplace, badges de conquista) é sempre baseada em comportamento verificável, nunca autodeclarada sem lastro.

## 21. Estratégia internacional

- Arquitetura de internacionalização já preparada desde o design técnico (`PROJECT_RULES.md` §39, `DATABASE.md` §10.5 — dados normalizados/codificados, tradução na camada de apresentação).
- Expansão faseada (roadmap comercial, seção 16): validação completa no mercado brasileiro antes de expansão, priorizando mercados com forte tradição numismática e idioma/cultura de menor distância (Portugal e demais países lusófonos, seguidos de mercados hispanofalantes).
- Catálogo mestre é o ativo que mais se beneficia de expansão internacional (mais países/séries catalogadas fortalecem o produto globalmente) — parcerias com curadores/especialistas locais por região são a estratégia primária de qualidade de dado internacional, não apenas tradução de interface.
- Marketplace cross-border é tratado como capacidade avançada (Fase 3+), pois envolve complexidade adicional de câmbio, envio físico e confiança entre países — nunca lançado antes da maturidade de confiança doméstica estar comprovada.

## 22. KPIs

KPIs centrais, organizados por motor de negócio (complementam os KPIs específicos já listados por funcionalidade em `FEATURE_CATALOG.md`):

| Categoria | KPI |
|---|---|
| Aquisição | Cadastros/dia; % de cadastros por canal; CAC (seção 24) |
| Ativação | Taxa de ativação D1 (1º item catalogado no dia do cadastro) |
| Engajamento | DAU/MAU; itens catalogados/usuário/semana; % de sessões offline |
| Monetização | Taxa de conversão free→premium; taxa de conversão premium→pro; GMV do marketplace; receita de comissão |
| Retenção | Retenção D7/D30/D90; churn mensal de assinatura |
| Comunidade | % de usuários com ≥1 troca concluída; NPS |
| Confiança/Segurança | Taxa de denúncias resolvidas; % de contas admin com MFA ativo |

## 23. OKRs

Estrutura de OKR trimestral (exemplo ilustrativo de estrutura, não de metas numéricas fixas — números reais são definidos em ciclo de planejamento à parte):

**Objetivo 1 — Provar que o produto resolve o problema central de catalogação.**
- KR: atingir taxa de ativação D1 definida como meta interna.
- KR: atingir NPS mínimo definido entre usuários ativos de 30 dias.
- KR: atingir tempo médio de catalogação de item abaixo do critério de aceite de `FEATURE_CATALOG.md` COL-005/COL-006.

**Objetivo 2 — Validar a conversão para receita recorrente.**
- KR: atingir taxa de conversão free→premium mínima viável.
- KR: atingir churn mensal de assinatura abaixo do teto aceitável definido pela liderança financeira.

**Objetivo 3 — Ativar liquidez inicial do marketplace.**
- KR: atingir volume mínimo de anúncios ativos por usuário vendedor.
- KR: atingir tempo médio até a primeira transação concluída em um anúncio novo.

## 24. CAC (Custo de Aquisição de Cliente)

CAC é calculado por canal (orgânico/comunidade tem CAC estruturalmente mais baixo que pago) e monitorado separadamente de "custo por cadastro" — o CAC relevante para o negócio é o custo por **usuário ativado** (que completou o momento aha), não por cadastro bruto, já que um cadastro que nunca cataloga um item não representa valor real adquirido. A estratégia de aquisição (seção 17) é deliberadamente construída para manter CAC baixo nas fases iniciais (orgânico/comunidade/parcerias) antes de introduzir aquisição paga, que só é escalada após validação de LTV (seção 25).

## 25. LTV (Lifetime Value)

LTV é modelado por segmento de persona (seção 6), já que o comportamento de monetização difere fortemente:
- **LTV de usuário `free` puro:** baixo/indireto, mas não nulo — contribui para o efeito de rede do marketplace e do catálogo mestre, o que tem valor estrutural mesmo sem receita direta.
- **LTV de assinante Premium:** receita recorrente de assinatura ao longo da vida útil estimada da assinatura (função de churn mensal, seção 27).
- **LTV de vendedor Pro/Verificado:** combina assinatura recorrente + comissão de marketplace recorrente — segmento de maior LTV individual esperado.

A relação **LTV:CAC saudável** (referência de mercado SaaS: LTV pelo menos 3x o CAC) é o critério central para decidir a intensidade de investimento em aquisição paga por canal e por segmento.

## 26. Receita recorrente

- **MRR (Receita Recorrente Mensal)** é composto majoritariamente por assinaturas Premium/Pro; comissão de marketplace é receita transacional e é reportada separadamente do MRR para não distorcer a leitura de previsibilidade de caixa.
- **ARR (Receita Recorrente Anual)** é a métrica-guia para conversas com investidores (seção 29), com trajetória de crescimento reportada por fase do Roadmap Comercial (seção 16).
- Ciclo anual de assinatura (com desconto — seção 11) é incentivado para melhorar previsibilidade de caixa e reduzir churn mensal medido.

## 27. Métricas SaaS

Conjunto padrão de métricas SaaS acompanhadas, além das já citadas (MRR/ARR/CAC/LTV):
- **Churn de receita (revenue churn)** vs. **churn de logos (usuários)** — reportados separadamente, já que um usuário pode fazer downgrade sem cancelar totalmente.
- **Net Revenue Retention (NRR)** — capaz de superar 100% quando expansão (upgrade Premium→Pro, aumento de uso de marketplace) supera o churn de receita.
- **Payback period de CAC** — tempo até o CAC de um canal se pagar via receita acumulada do usuário adquirido.
- **Take rate efetivo do marketplace** — comissão total cobrada dividida pelo GMV total transacionado, monitorado por segmento de plano (dado o desconto de comissão para Pro, seção 14).

## 28. Roadmap de crescimento

Trajetória de crescimento alinhada ao Roadmap Comercial (seção 16), mas com foco explícito em alavancas de crescimento composto:
1. **Densidade de catálogo mestre** cresce com uso (cada item catalogado manualmente que não existia no catálogo é uma contribuição, sujeita a curadoria — `DATABASE.md` §11 fluxo de moderação) → produto melhora para todos → mais aquisição orgânica.
2. **Liquidez de marketplace** cresce com base de usuários ativos → mais vendedores atraem mais compradores e vice-versa (efeito de rede bilateral clássico).
3. **Comunidade/eventos** ancoram crescimento fora do digital, reduzindo dependência de canais pagos escaláveis, mas caros, de aquisição.
4. **Expansão internacional** (seção 21) multiplica o mercado endereçável sem exigir reconstrução de produto, dado que a arquitetura já suporta (`PROJECT_RULES.md` §39).

## 29. Estratégia para investidores

- **Narrativa central:** mercado de nicho profundo (numismática) com padrão comprovado em outras categorias de colecionáveis de que ferramentas digitais verticais + marketplace nativo geram negócios defensáveis e lucrativos em escala menor, porém com margens e lealdade de cliente superiores a produtos horizontais genéricos.
- **Prova de tração prioritária:** ativação (D1), retenção (D7/D30) e primeira liquidez de marketplace — métricas de produto vêm antes de métricas de receita bruta nas conversas de estágio inicial (`PROJECT_RULES.md` §1.6 — segurança e consistência antes de velocidade também se reflete aqui: crescimento sem retenção real não é vendido como sucesso).
- **Defensabilidade a comunicar:** dado proprietário (catálogo mestre curado + histórico de coleção pessoal), efeito de rede bilateral do marketplace, e confiança/segurança de arquitetura (RLS, auditoria) como diferencial difícil de replicar rapidamente por um concorrente novo.
- **Uso de capital:** priorizado, nesta ordem, para (1) qualidade e cobertura do catálogo mestre e da IA, (2) confiança/segurança do marketplace, (3) expansão de aquisição apenas após unit economics validado — nunca a ordem inversa.

## 30. Estratégia de expansão

- **Expansão de produto (vertical):** de catalogação → avaliação assistida por IA → marketplace → serviços de maior confiança (verificação de autenticidade, seção 11/12) → camada B2B para organizações — cada camada nova é construída sobre a confiança já conquistada na anterior, nunca lançada isoladamente.
- **Expansão geográfica (horizontal):** conforme seção 21, faseada e ancorada em qualidade de catálogo mestre local, não apenas tradução.
- **Expansão de categoria adjacente (opcional, longo prazo):** o mesmo modelo (catalogação + IA + comunidade + marketplace) é estruturalmente aplicável a outras categorias de colecionáveis de alto valor documental (selos, por exemplo) — avaliado apenas após o Numora atingir maturidade comprovada em numismática, para não diluir foco e posicionamento (seção 4) prematuramente.
