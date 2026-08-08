# UX_BIBLE.md — Numisphere

> **Papel deste documento:** fonte única de verdade da experiência visual e de interação do Numisphere. Complementa — sem alterar — `PROJECT_RULES.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API_SPEC.yaml` e `PRODUCT_BIBLE.md`. Onde o `PRODUCT_BIBLE.md` define **o que** cada módulo faz (fluxos, regras, mensagens), este documento define **como ele se parece, se comporta e se sente** — a camada visual e sensorial, não o código que a implementa.
> **Para quem é:** Designers (decisões de UI ficam consistentes sem reinventar a cada tela), Desenvolvedores front-end (tokens e padrões são o contrato visual a implementar), QA (critério objetivo do que é "certo" visualmente).
> **Não faz parte deste documento:** HTML/CSS/React, mockups de tela específica, nomes de variáveis de código. Os valores aqui (cores, escalas, durações) são a **especificação de design**, a ser traduzida em tokens de implementação pela equipe de front-end conforme `PROJECT_RULES.md` (Tailwind + design tokens próprios).
> **Status:** Lote 1 de N. Ver nota de progresso ao final do arquivo.

---

## Sumário deste lote

1. Design Philosophy
2. Design Principles
3. Brand Personality
4. UX Principles
5. UI Principles
6. Design Tokens
7. Color Palette
8. Typography
9. Icons
10. Elevation
11. Shadows
12. Motion Design
13. Microinteractions
14. Empty States
15. Error States
16. Success States
17. Loading States
18. Skeletons
19. Feedback Visual

---

# 1. Design Philosophy

O Numisphere existe para guardar coisas que importam — peças que carregam história de família, décadas de dedicação, ou valor financeiro real. A filosofia de design parte de uma pergunta única, aplicada a cada decisão: **"isto faz a peça do usuário parecer mais valiosa e mais bem cuidada, ou menos?"**

Três ideias sustentam essa filosofia:

- **A peça é a protagonista, a interface é a curadoria.** Assim como um bom museu usa iluminação e vitrine para valorizar o objeto sem competir com ele, o Numisphere usa fundo neutro, tipografia discreta e cor comedida para que a foto da moeda ou cédula seja sempre o elemento mais vívido da tela.
- **Precisão visual comunica confiança de dado.** Numismática é uma disciplina de detalhe (uma risca no metal muda uma classificação de grading). A interface reflete essa precisão: alinhamentos exatos, espaçamento consistente, números bem formatados — nunca "quase certo".
- **Calma sobre estímulo.** O produto não compete por tempo de tela como uma rede social; compete por ser o lugar em que o colecionador confia para guardar o que tem. Cores vibrantes, gamificação e notificações existem, mas sempre subordinadas à sobriedade do ambiente principal (a coleção).

## 1.1. O que o produto NÃO é (contraste deliberado)

- Não é um app de rede social ruidoso (sem feed infinito de estímulo, sem contadores de curtida como métrica central).
- Não é um catálogo institucional frio e burocrático (não é um museu digital sem alma — há calor humano na forma como a coleção pessoal é apresentada).
- Não é "gamificado a qualquer custo" — conquistas e ranking existem no módulo social, nunca invadindo a experiência central de catalogação com badges/confetes exagerados.

---

# 2. Design Principles

Princípios acionáveis, na ordem em que resolvem conflito de decisão de design:

1. **Clareza antes de beleza.** Uma tela bonita que confunde perde para uma tela simples que informa corretamente.
2. **Um objetivo primário por tela.** Toda tela tem uma ação principal óbvia (CTA primário único e visualmente dominante); ações secundárias existem, mas nunca competem visualmente com a primária.
3. **Reversibilidade visível.** Sempre que uma ação tem consequência, o caminho de desfazer/cancelar é tão visível quanto a ação em si.
4. **Progressive disclosure.** Informação avançada (metadados técnicos de grading, histórico de auditoria) fica disponível, mas não exposta por padrão — o usuário aprofunda por escolha, não por obrigação.
5. **Consistência antes de novidade.** Um padrão já estabelecido (como um cartão de item) nunca é reinventado para um caso "especial" sem justificativa de UX documentada.
6. **Toque generoso, densidade sob demanda.** Mobile prioriza áreas de toque confortáveis; desktop pode adensar informação — nunca o contrário.
7. **Todo estado é desenhado.** Vazio, carregando, erro e sucesso são tratados como cidadãos de primeira classe do design, não como afterthought (ver seções 14–19).

---

# 3. Brand Personality

Se o Numisphere fosse uma pessoa, seria: **um curador de museu que também é seu amigo colecionador** — conhece profundamente o assunto, mas nunca fala de cima para baixo; é cuidadoso e metódico, mas não é frio; celebra uma boa descoberta com o usuário, sem exagero.

| Atributo | O Numisphere é... | O Numisphere não é... |
|---|---|---|
| Tom | Confiável, caloroso, preciso | Corporativo, genérico, informal demais |
| Linguagem | Clara, em pt-BR natural, sem jargão desnecessário | Cheia de termos técnicos não explicados |
| Ritmo visual | Calmo, espaçado, respirável | Denso, ruidoso, cheio de badges piscando |
| Cor | Comedida, com um acento de destaque proposital | Multicolorida sem hierarquia |
| Humor/tom de voz | Gentil, encorajador ("vamos catalogar sua primeira peça?") | Sarcástico, robótico, excessivamente formal |

**Arquétipo de marca:** o Sábio (conhecimento, clareza, verdade) temperado pelo Cuidador (proteção do que importa para o usuário) — nunca o Bobo da Corte (humor gratuito) nem o Governante (autoridade fria).

---

# 4. UX Principles

Princípios de experiência aplicados especificamente à interação (complementam os Design Principles, seção 2, com foco em comportamento):

- **Nunca surpreender destrutivamente.** Toda ação irreversível ou de alto impacto (excluir, cancelar transação, sair de uma troca em andamento) exige confirmação explícita com o nome do item/ação envolvida — nunca um "Tem certeza?" genérico.
- **Feedback imediato, confirmação eventual.** Ações de baixo risco (favoritar, curtir) respondem instantaneamente na interface (otimista) mesmo que a sincronização de servidor leve um instante; ações de alto risco (vender, excluir) esperam confirmação do servidor antes de mostrar sucesso.
- **O caminho manual sempre existe.** Todo recurso assistido por IA (Scanner, Identificação) tem, a um toque de distância, o caminho 100% manual equivalente — nunca um beco sem saída se a IA falhar.
- **Offline é um estado, não um erro.** A ausência de conexão é comunicada como informação neutra ("offline — sincronizando quando reconectar"), nunca como uma falha vermelha alarmante, alinhado a `PRODUCT_BIBLE.md` RN-05.
- **Erros são educativos, não punitivos.** Mensagem de erro sempre explica o que aconteceu e o que fazer a seguir — nunca apenas "Algo deu errado."
- **A busca é sempre uma opção, nunca uma obrigação.** Em qualquer lista longa (coleção, catálogo, marketplace), busca/filtro está visível, mas a navegação por scroll/categoria continua sendo o caminho principal para quem prefere explorar.

---

# 5. UI Principles

- **Grid e alinhamento são inegociáveis.** Nenhum elemento "flutua" fora da grade base (seção 20); alinhamento consistente é o que dá a sensação de precisão da seção 1.
- **Hierarquia por peso, não por quantidade de cor.** Diferenciar "primário" de "secundário" prioritariamente via tamanho/peso tipográfico e contraste de neutros — cor de destaque é usada com parcimônia, reservada a ações e estados que realmente precisam chamar atenção.
- **Componentes, não composições ad-hoc.** Toda tela é montada a partir da biblioteca de componentes reutilizáveis (seção 42) — uma necessidade nova gera um componente novo documentado, não uma solução única e isolada.
- **Fotografia é tratada como conteúdo nobre.** Fotos de peças nunca são cortadas de forma que perca informação relevante (a borda de uma moeda importa); proporção e crop seguem regra fixa por contexto (miniatura vs. detalhe).
- **Números merecem fonte tabular.** Preços, contagens e datas usam variantes tabulares da tipografia (alinhamento numérico consistente), essencial em um produto onde o usuário compara valores constantemente.
- **Dark mode é cidadão de primeira classe, não inversão automática.** Todo componente é desenhado pensando nos dois modos desde a concepção (ver seções 44–45), nunca um filtro aplicado depois.

---

# 6. Design Tokens

Os tokens são a camada de tradução entre este documento e a implementação (Tailwind + tokens próprios, conforme `PROJECT_RULES.md` §3). Este documento define **a especificação de valor e a intenção semântica**; a nomenclatura literal de variável é responsabilidade do front-end, mas deve seguir a estrutura semântica abaixo, nunca nomear um token pela cor literal (ex.: `color-primary`, nunca `color-blue`) — para que dark mode e possíveis rebrands futuros troquem o valor sem trocar o significado.

**Categorias de token:**
| Categoria | Exemplos de nome semântico | Cobertura |
|---|---|---|
| Cor | `color-bg-surface`, `color-text-primary`, `color-accent`, `color-border-subtle` | Seção 7 |
| Tipografia | `font-size-body`, `font-weight-heading`, `line-height-tight` | Seção 8 |
| Espaçamento | `space-xs` … `space-3xl` | Escala 4px (seção 20) |
| Raio de borda | `radius-sm`, `radius-md`, `radius-full` | Cards, botões, inputs |
| Elevação | `elevation-0` … `elevation-4` | Seção 10 |
| Duração de movimento | `motion-duration-fast/base/slow` | Seção 12 |
| Easing | `motion-ease-standard/enter/exit` | Seção 12 |
| Z-index | `z-dropdown`, `z-modal`, `z-toast` | Camadas de sobreposição |

**Regra de governança:** nenhum valor "mágico" (hexadecimal solto, `16px` avulso) é usado fora de um token nomeado — toda decisão visual nova passa primeiro pela pergunta "isso já é um token existente?" antes de virar um valor novo.

---

# 7. Color Palette

## 7.1. Papel da cor no produto

A paleta é deliberadamente **neutra-dominante com um único acento de marca** — reflexo direto da Design Philosophy (seção 1): a foto da peça numismática é sempre o elemento mais colorido da tela.

## 7.2. Paleta Neutra (base de 90%+ da interface)

Escala de cinzas com leve tom quente (não cinza-azulado frio), remetendo a papel e metal envelhecido — reforça a personalidade "curador de museu" sem cair em sépia literal:
`neutral-0` (branco) → `neutral-50, 100, 200, 300, 400, 500, 600, 700, 800, 900` → `neutral-950` (quase preto), 11 degraus, uso consistente entre claro/escuro (seções 44–45 definem o mapeamento).

## 7.3. Cor de Marca (Accent)

Um único tom de acento — proposto como um **dourado-cobre desaturado** (referência direta ao metal numismático, sem parecer "app de finanças" genérico) — usado exclusivamente para: CTA primário, estado ativo de navegação, links, foco de elementos interativos. Nunca usado em grandes áreas de fundo (mantém o efeito de "destaque raro e intencional").

## 7.4. Cores Semânticas (estado, não decoração)

| Papel | Intenção | Uso |
|---|---|---|
| `success` | Verde desaturado (não neon) | Confirmações, saldo positivo, transação concluída |
| `warning` | Âmbar | Avisos não-bloqueantes, limite se aproximando |
| `danger` | Vermelho terroso (não puro/vibrante) | Erros, ações destrutivas, saldo negativo |
| `info` | Azul acinzentado | Dicas, estados neutros informativos |

Cores semânticas seguem a mesma lógica de escala em degraus (ex.: `success-100` para fundo suave de badge, `success-600` para texto/ícone) — nunca usadas em tom puro/saturado máximo, para manter coerência com a paleta neutra-dominante.

## 7.5. Regras de uso

- Contraste mínimo AA (seção 25) verificado para toda combinação texto/fundo antes de aprovação.
- Cor nunca é o único indicador de estado (sempre acompanhada de ícone/texto) — requisito de acessibilidade e também de clareza (seção 4).
- Paleta de catálogo/material (ex.: representar visualmente "prata" vs. "ouro" vs. "bronze" em tags de material) usa uma micro-paleta própria, derivada dos neutros + accent, nunca cores arbitrárias novas fora do sistema.

---

# 8. Typography

## 8.1. Papel da tipografia

Como a cor é comedida (seção 7), a tipografia carrega grande parte da hierarquia visual do produto — por isso a escala é deliberadamente clara e com poucos saltos ambíguos.

## 8.2. Família tipográfica

- **Fonte principal (UI e corpo de texto):** uma humanist sans-serif de alta legibilidade em telas pequenas, com bom suporte a acentuação em português.
- **Fonte numérica/tabular:** a mesma família, usando a variante de números tabulares (seção 5) para preços, datas, contagens — nunca uma segunda família tipográfica só para números (mantém coesão visual).
- Sem fonte serifada decorativa — reforça a personalidade "claro e confiável" (seção 3) em vez de "clássico/antiquado", mesmo em um produto sobre objetos antigos.

## 8.3. Escala tipográfica

Escala modular, 7 degraus, nomeados por função (não por tamanho em px, para permitir ajuste global sem renomear):

| Token | Uso |
|---|---|
| `text-display` | Números grandes de destaque (valor total da coleção no dashboard) |
| `text-heading-lg` | Título de tela |
| `text-heading-md` | Título de seção/card destacado |
| `text-heading-sm` | Título de card padrão, subtítulo |
| `text-body` | Corpo de texto padrão |
| `text-body-sm` | Texto secundário, legendas, metadados |
| `text-caption` | Rótulos, tags, texto auxiliar mínimo |

## 8.4. Pesos

Apenas 3 pesos usados no produto: `regular` (corpo), `medium` (ênfase leve, rótulos), `semibold` (títulos, CTAs). Peso `bold`/`black` reservado a casos muito raros de destaque extremo (ex.: valor de destaque no dashboard) — excesso de peso forte enfraquece a hierarquia geral.

## 8.5. Regras

- Altura de linha generosa em corpo de texto (conforto de leitura de descrições de peças, muitas vezes longas).
- Comprimento de linha de texto corrido limitado (medida confortável de leitura) em telas largas (desktop) — nunca texto esticado de borda a borda em viewport grande.
- Truncamento de texto (`...`) sempre com o texto completo disponível via toque/hover (tooltip ou expansão), nunca informação perdida silenciosamente.

---

# 9. Icons

## 9.1. Estilo

Ícones de traço (outline), peso de linha consistente em toda a biblioteca, cantos levemente arredondados (eco do `radius` de cards/botões) — nunca misturar estilo outline com estilo preenchido/sólido no mesmo contexto, exceto para indicar estado ativo (ex.: estrela de favorito outline → preenchida ao favoritar).

## 9.2. Tamanhos

Escala fixa em três tamanhos: pequeno (contexto inline com texto de rótulo), médio (padrão — ações de toolbar, itens de navegação), grande (estado vazio, ilustração de feedback). Nenhum ícone é redimensionado livremente fora desses três tamanhos.

## 9.3. Semântica e biblioteca

- Biblioteca única e consistente (não misturar de múltiplas fontes de ícone com traços diferentes).
- Ícone nunca é o único portador de significado em uma ação crítica — sempre acompanhado de rótulo textual, exceto em contextos de altíssima familiaridade (voltar, fechar) e mesmo assim com `aria-label` (seção 25).
- Ícones específicos de domínio (moeda, cédula, medalha, token, grading) formam um subconjunto próprio e ilustrado à parte — tratados quase como pequenos "selos", com leve diferenciação de estilo (ainda outline, mas com um detalhe de identidade) para reforçar a categoria do item de relance.

---

# 10. Elevation

Sistema de 5 níveis (`elevation-0` a `elevation-4`), comunicando hierarquia espacial de forma consistente com sombra (seção 11):

| Nível | Uso |
|---|---|
| `elevation-0` | Conteúdo no plano da página (a maioria dos elementos) |
| `elevation-1` | Card em repouso (item de coleção, card de anúncio) |
| `elevation-2` | Card em estado de hover/foco, elementos de navegação fixos (header) |
| `elevation-3` | Popover, dropdown, tooltip |
| `elevation-4` | Modal, bottom sheet, diálogo de confirmação |

Regra: elevação mais alta sempre implica que o elemento pode ser dispensado (fechado) e está temporariamente sobre o conteúdo principal — nunca usada apenas por efeito decorativo.

---

# 11. Shadows

Sombras seguem os níveis de elevação (seção 10), com estas regras:
- **Luz vem de cima**, de forma consistente em toda a interface (sombra sempre projetada para baixo, nunca lateral/invertida).
- Sombra sutil e desaturada (nunca preta pura) — em light mode, sombra com leve tom neutro-quente coerente com a paleta (seção 7); em dark mode, elevação é comunicada primariamente por variação de superfície (seção 44), com sombra quase ausente (sombra "some" visualmente em fundo escuro — usar borda sutil e diferença de luminosidade em vez de depender de sombra).
- Sombra nunca substitui espaçamento — dois elementos elevados ainda respeitam distância mínima da grade (seção 20), a sombra reforça a separação, não a cria sozinha.

---

# 12. Motion Design

## 12.1. Papel do movimento

Movimento no Numisphere **explica**, não decora: toda animação existe para responder a uma pergunta do usuário ("de onde isso veio?", "o que mudou?", "isso está carregando ou travou?"). Nenhuma animação é puramente ornamental.

## 12.2. Durações

Escala de 3 durações nomeadas:
| Token | Faixa aproximada | Uso |
|---|---|---|
| `motion-duration-fast` | ~100–150ms | Microinterações (toggle, hover, tap feedback) |
| `motion-duration-base` | ~200–300ms | Transições de tela, abertura de modal/card |
| `motion-duration-slow` | ~400–500ms | Transições complexas (ex.: expansão de galeria em tela cheia) |

## 12.3. Easing

- **Entrada** (elemento aparecendo): easing de desaceleração (começa rápido, termina suave) — sensação de "chegar e se acomodar".
- **Saída** (elemento saindo): easing de aceleração (começa suave, termina rápido) — sensação de "sair do caminho".
- Nunca usar curva linear em transições perceptíveis (parece mecânico, contraria a personalidade calorosa da seção 3).

## 12.4. Regras

- Toda animação de UI respeita a preferência de sistema de "reduzir movimento" (acessibilidade — seção 25), substituindo transição por simples cross-fade curto ou corte direto.
- Elementos que mudam de posição (ex.: item movido entre coleções) usam transição de movimento compartilhado (o olho acompanha o elemento) sempre que tecnicamente viável — nunca "sumir e reaparecer" em outro lugar sem transição, quando a mudança é resultado direto de uma ação do usuário.
- Carregamento nunca é comunicado só por movimento (ver Skeletons, seção 18) — sempre também por mensagem/label para leitores de tela.

---

# 13. Microinteractions

Pequenas respostas a ações pontuais — o "tato" da interface:

| Interação | Resposta esperada |
|---|---|
| Toque em botão | Leve escala/opacidade no `fast`, retorno ao normal na liberação |
| Favoritar (toggle) | Preenchimento do ícone com pequena animação de "pop" — feedback imediato, otimista (seção 4) |
| Puxar para atualizar (pull-to-refresh) | Indicador de progresso circular nativo do padrão de plataforma |
| Item adicionado com sucesso | Confirmação visual breve (seção 16) próxima ao ponto de ação, não um modal intrusivo |
| Campo de formulário validado com sucesso | Indicador sutil (ex.: check) ao lado do campo, sem alarde |
| Arrastar para reordenar/mover (drag) | Elemento "levanta" (aumenta elevação — seção 10) durante o arraste, "assenta" com leve animação ao soltar |
| Copiar valor (ex.: endereço de link público) | Confirmação textual breve tipo toast, auto-dispensada |

Regra geral: toda microinteração usa `motion-duration-fast`; nenhuma microinteração bloqueia a próxima ação do usuário (são não-modais por definição).

---

# 14. Empty States

## 14.1. Princípio

Um estado vazio nunca é uma tela em branco — é a **primeira oportunidade de orientar o usuário para a ação certa**. Todo estado vazio no produto tem: ilustração/ícone leve (grande, outline, tom neutro — nunca fotografia genérica de banco de imagens), mensagem curta e humana (tom da seção 3), e CTA claro quando houver uma ação óbvia a seguir.

## 14.2. Variações por contexto

| Contexto | Tom da mensagem | CTA |
|---|---|---|
| Coleção vazia (usuário novo) | Encorajador, convite ao primeiro item | "Adicionar item" |
| Resultado de busca/filtro sem resultado | Neutro, sugestivo | "Limpar filtros" |
| Lista social vazia (favoritos, wishlist) | Explicativo do que vai aparecer ali | Ação contextual ou nenhuma (ok não ter CTA se a ação é feita em outro lugar) |
| Módulo ainda sem uso (ex.: nenhuma troca) | Convite leve, sem pressão | Link para explorar o módulo relacionado |

## 14.3. Regra

Estado vazio nunca usa linguagem que soe como erro ("Nada encontrado!" em tom alarmante) nem culpa o usuário — é sempre um convite, nunca uma cobrança.

---

# 15. Error States

## 15.1. Princípio

Erro é tratado como informação, não como falha do usuário (alinhado a `PRODUCT_BIBLE.md` §1.9 e UX Principle da seção 4 deste documento).

## 15.2. Camadas de erro

| Camada | Onde aparece | Exemplo |
|---|---|---|
| Erro de campo (validação) | Inline, junto ao campo, no momento do erro | "Este campo é obrigatório." abaixo do input |
| Erro de ação (submissão) | Próximo ao botão de ação / topo do formulário | "Não foi possível salvar. Verifique os campos destacados." |
| Erro de carregamento de tela | Substitui o conteúdo da área afetada, com opção de tentar novamente | Ícone + "Não conseguimos carregar isso agora." + botão "Tentar novamente" |
| Erro de conexão | Faixa discreta e persistente, não-bloqueante | "Você está offline — algumas ações ficam indisponíveis." |
| Erro crítico de sistema (500) | Tela de erro dedicada apenas quando não há conteúdo parcial para mostrar | Mensagem genérica amigável + ação de voltar/recarregar |

## 15.3. Regras visuais

- Cor `danger` (seção 7.4) é usada com moderação — o ícone/borda do campo muda de cor, mas o restante da tela permanece estável (erro não "pinta a tela de vermelho").
- Nenhuma mensagem de erro usa terminologia técnica (código HTTP, nome de exception) — vocabulário 100% humano.
- Erro nunca faz o usuário perder dado já inserido (ver `PRODUCT_BIBLE.md` §1.9) — o estado de erro convive com o formulário preenchido.

---

# 16. Success States

## 16.1. Princípio

Sucesso é confirmado, mas de forma proporcional à importância da ação — evitando tanto a dúvida ("será que salvou?") quanto o exagero (confete para cada toque).

## 16.2. Camadas de sucesso

| Intensidade | Uso | Padrão visual |
|---|---|---|
| Sutil | Toggle, favoritar, campo validado | Ícone/cor muda de estado instantaneamente, sem texto adicional |
| Padrão | Item salvo, formulário enviado | Toast/snackbar breve, auto-dispensado, tom `success` |
| Celebrado | Marco relevante (primeiro item catalogado, conquista desbloqueada) | Momento visual um pouco mais expressivo (ainda contido — nunda tela cheia de confete), alinhado à seção 3 (Sábio + Cuidador, não Bobo da Corte) |

## 16.3. Regra

Sucesso "padrão" nunca bloqueia o fluxo (nunca um modal que exige clique para fechar após uma ação de sucesso simples) — o usuário segue seu caminho, a confirmação é periférica.

---

# 17. Loading States

## 17.1. Princípio

Todo carregamento perceptível (>~300ms) tem uma representação visual — nunca uma tela congelada sem feedback. A escolha entre spinner, skeleton (seção 18) e barra de progresso segue o contexto:

| Contexto | Padrão indicado |
|---|---|
| Carregamento de lista/tela inteira | Skeleton (seção 18) — comunica a forma do conteúdo que está vindo |
| Ação pontual (botão de salvar) | Estado de carregamento no próprio botão (label muda + indicador pequeno), botão desabilitado durante o processo |
| Upload de arquivo com progresso mensurável | Barra de progresso determinística |
| Processo sem estimativa de tempo (análise de IA) | Indicador indeterminado + mensagem contextual ("Analisando sua peça...") |
| Sincronização em segundo plano (offline → online) | Indicador discreto e persistente, não-modal |

## 17.2. Regra

Nenhum carregamento maior que poucos segundos fica sem uma mensagem textual de apoio (evita a sensação de app travado) — o indicador visual sozinho não é suficiente para esperas longas.

---

# 18. Skeletons

## 18.1. Princípio

Skeletons representam a **forma aproximada** do conteúdo final (retângulos/formas no lugar de imagem, texto, botão) — nunca um spinner genérico central para conteúdo de lista/grade, porque o skeleton reduz a percepção de espera ao já comunicar o layout que está chegando.

## 18.2. Regras

- Skeleton usa uma variação sutil de tom entre os neutros (seção 7.2), com uma animação leve de "pulso" ou "shimmer" (duração `motion-duration-slow`, em loop suave) — nunca cor de destaque (`accent`) em skeleton.
- Skeleton reflete a quantidade aproximada de itens esperados (ex.: 4–6 cards de skeleton na grade da coleção), nunca um único bloco genérico para uma lista.
- Transição do skeleton para o conteúdo real é um fade curto (`motion-duration-fast`), nunca uma troca abrupta.

---

# 19. Feedback Visual

## 19.1. Síntese transversal

Esta seção consolida o **sistema de feedback** do produto, amarrando as seções 14–18 em um princípio único: **o usuário nunca deve se perguntar "o que está acontecendo agora?"**. Todo estado do sistema (vazio, carregando, erro, sucesso, normal) tem uma representação visual distinta e inequívoca.

## 19.2. Tabela-mestra de estados x resposta visual

| Estado do sistema | Resposta visual primária | Resposta secundária |
|---|---|---|
| Vazio | Ilustração + mensagem (seção 14) | CTA quando aplicável |
| Carregando | Skeleton/spinner/progresso (seções 17–18) | Mensagem de apoio se demorado |
| Erro | Cor `danger` + ícone + mensagem humana (seção 15) | Ação de recuperação (tentar novamente) |
| Sucesso | Cor `success` + confirmação proporcional (seção 16) | Nenhuma, se sutil; toast, se padrão |
| Offline | Faixa neutra persistente (não `danger`) | Indicador de sincronização pendente |
| Normal/populado | Conteúdo real, sem decoração de estado | — |

## 19.3. Regra de exclusividade

Uma tela nunca mistura dois estados de feedback conflitantes simultaneamente na mesma região (ex.: skeleton e mensagem de erro sobrepostos) — a transição entre estados é sempre limpa: um estado sai completamente antes do próximo entrar.

---

## Nota de progresso (remover ao concluir o documento)

Lote 1 cobre as seções 1–19 (fundamentos: filosofia, princípios, marca, tokens, cor, tipografia, ícones, elevação/sombra, movimento, microinterações e os 5 estados de sistema).

Pendente para os próximos lotes — seções 20–50:
Layout Grid, Responsividade, Mobile First, Desktop, Tablet, Acessibilidade WCAG AA, Navegação, Bottom Navigation, Sidebar, Header, Search UX, Scanner UX, Marketplace UX, Dashboard UX, Chat UX, Coleção UX, Perfil UX, Sistema de filtros, Cards, Listas, Modais, Tabelas, Componentes reutilizáveis, Design dos gráficos, Dark Mode, Light Mode, Animações, Feedback tátil, Gestos Mobile, Padrões para formulários, Padrões para upload de imagens.
