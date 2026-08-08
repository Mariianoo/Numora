# PRODUCT_BIBLE.md — Numisphere (CoinVerse)

> **Papel deste documento:** referência única de produto para Product Managers, Designers, Desenvolvedores e QA. Complementa — e nunca contradiz — `PROJECT_RULES.md`, `ARCHITECTURE.md`, `DATABASE.md` e `API_SPEC.yaml`, que permanecem intocados. Onde este documento menciona uma regra técnica, ela é a mesma definida nesses documentos; o objetivo aqui é o **comportamento de produto observável pelo usuário**, não a implementação.
> **Convenção de leitura:** cada módulo segue o mesmo roteiro fixo (Objetivo → Quem pode acessar → Fluxo completo → Validações → Regras → Permissões → Mensagens → Estados → Exceções → Critérios de aceite), para permitir comparação direta entre módulos e uso como checklist de QA.
> **Status:** Lote 1 de N. Ver nota de progresso ao final do arquivo.

---

## Sumário deste lote

1. Visão do Produto
2. Módulo — Cadastro
3. Módulo — Login
4. Módulo — Minha Coleção
5. Módulo — Adicionar Moeda
6. Módulo — Adicionar Cédula
7. Módulo — Scanner IA
8. Módulo — Identificação IA
9. Módulo — Galeria
10. Módulo — Favoritos

---

# 1. Visão do Produto

## 1.1. Missão

Dar a qualquer colecionador de moedas, cédulas, medalhas e tokens — do iniciante curioso ao investidor experiente — um lugar único, confiável e sempre acessível para **catalogar, entender e valorizar** sua coleção, e para se conectar com outros colecionadores de forma segura.

## 1.2. Público-alvo

| Segmento | Descrição | Necessidade central |
|---|---|---|
| Iniciante curioso | Ganhou/herdou algumas peças, não sabe o que tem | Identificar e aprender |
| Colecionador hobbista | Coleciona por tema/país há anos, catálogo em planilha ou caderno | Organizar e não perder informação |
| Colecionador investidor | Trata a coleção como ativo, acompanha mercado | Avaliação, histórico de valor, segurança |
| Lojista/negociante | Compra e vende como atividade recorrente | Vitrine, reputação, gestão de inventário |
| Colecionador social | Gosta da comunidade tanto quanto do acervo | Trocas, eventos, ranking, conquistas |

## 1.3. Proposta de Valor

> "O cofre digital + a enciclopédia + a comunidade do colecionador — no bolso, funcionando mesmo sem internet."

Pilares de valor, em ordem de prioridade quando houver conflito de produto:
1. **Confiança no dado** — um item mal catalogado ou um valor incorreto quebra a razão de existir do produto.
2. **Simplicidade no essencial** — adicionar um item à coleção é o fluxo mais usado do produto e deve ser o mais rápido e à prova de erro.
3. **Inteligência assistida, não substitutiva** — IA acelera catalogação e avaliação, mas nunca decide sozinha por trás do usuário sem transparência.
4. **Comunidade com propósito** — trocas, chat, eventos e ranking existem para servir o colecionismo, não para maximizar tempo de tela.

## 1.4. Personas

### Persona 1 — "Marcos, o Iniciante"
- 34 anos, herdou uma caixa de moedas do avô.
- Não sabe os nomes técnicos (grading, mintage, etc.).
- Objetivo no produto: tirar foto, descobrir o que tem, entender se vale algo.
- Frustração-chave: jargão técnico e formulários longos.
- Uso principal: Scanner IA, Identificação IA, Galeria.

### Persona 2 — "Renata, a Hobbista Organizada"
- 51 anos, coleciona cédulas brasileiras há 20 anos.
- Tinha tudo em planilha Excel; quer migrar sem perder nada.
- Objetivo no produto: catalogar com precisão, manter histórico e notas pessoais.
- Frustração-chave: perder dado ao migrar, app que trava ao adicionar item.
- Uso principal: Minha Coleção, Adicionar Cédula, Importação, Wishlist.

### Persona 3 — "Eduardo, o Investidor"
- 45 anos, vê a coleção como parte do patrimônio.
- Acompanha valorização, decide compra/venda com base em dado.
- Objetivo no produto: avaliação confiável, histórico de mercado, segurança do dado.
- Frustração-chave: estimativas de valor sem transparência sobre a fonte.
- Uso principal: Marketplace, Assinaturas/Premium, Relatórios (exportação).

### Persona 4 — "Camila, a Lojista Verificada"
- 39 anos, revende peças numismáticas como parte da renda.
- Precisa de reputação visível e gestão de vários anúncios.
- Objetivo no produto: vender com confiança, responder rápido, manter histórico de vendas.
- Frustração-chave: fraude/calote, falta de ferramentas de gestão em lote.
- Uso principal: Marketplace, Chat, Perfil (verificação), Exportação.

### Persona 5 — "Bruno, o Social"
- 28 anos, gosta tanto da comunidade quanto do acervo.
- Participa de feiras, troca duplicatas, gosta de reconhecimento.
- Objetivo no produto: trocar, subir no ranking, ir a eventos.
- Frustração-chave: comunidade vazia ou sem moderação.
- Uso principal: Trocas, Ranking, Conquistas, Eventos, Chat.

## 1.5. Jornada do Usuário (visão macro)

```
Descoberta → Cadastro → Onboarding → Primeiro item catalogado (momento "aha") →
Uso recorrente (catalogar mais itens) → Engajamento social (trocas/comunidade) →
Conversão (Premium) → Retenção de longo prazo (coleção como acervo de valor)
```

**Momento "aha" definido:** o usuário adiciona o primeiro item e vê, em menos de 2 minutos do cadastro, uma ficha completa (foto + dado do catálogo mestre reconhecido, manual ou por IA). Todo o onboarding é desenhado para acelerar esse momento, não para explicar o produto em telas de texto.

**Jornada detalhada (etapas e estado emocional esperado):**
1. **Descoberta** (loja de apps, indicação, busca) — curiosidade.
2. **Cadastro** — expectativa; qualquer fricção aqui é abandono.
3. **Onboarding leve** (3 telas no máximo, puláveis) — orientação sem obrigação.
4. **Primeiro item** — momento de encantamento ou de frustração (se falhar, risco alto de churn no dia 1).
5. **Construção do acervo** (semanas 1-4) — hábito.
6. **Descoberta da comunidade** (trocas, wishlist, eventos) — pertencimento.
7. **Consideração de Premium** (gatilho: limite atingido ou desejo de recurso avançado) — decisão de valor.
8. **Uso maduro** (meses+) — a coleção vira histórico de vida, altíssima retenção e baixíssima tolerância a perda de dado.

## 1.6. Casos de Uso (visão consolidada)

| # | Caso de uso | Persona principal | Módulo(s) envolvido(s) |
|---|---|---|---|
| CU01 | Catalogar item por foto com ajuda de IA | Marcos | Scanner IA, Identificação IA, Adicionar Moeda |
| CU02 | Catalogar item manualmente com precisão | Renata | Adicionar Moeda, Adicionar Cédula |
| CU03 | Migrar coleção existente em massa | Renata | Importação |
| CU04 | Acompanhar valorização estimada da coleção | Eduardo | Minha Coleção, Marketplace |
| CU05 | Vender um item com segurança | Camila | Marketplace, Chat |
| CU06 | Comprar um item de outro colecionador | Eduardo, Bruno | Marketplace, Chat |
| CU07 | Trocar itens sem dinheiro envolvido | Bruno | Trocas, Chat |
| CU08 | Ser avisado quando um item da wishlist aparecer à venda | Eduardo, Bruno | Wishlist, Notificações |
| CU09 | Subir no ranking da comunidade | Bruno | Ranking, Conquistas |
| CU10 | Participar de um evento numismático | Bruno | Eventos |
| CU11 | Exportar relatório da coleção (ex.: para seguro) | Eduardo | Exportação |
| CU12 | Moderar conteúdo denunciado | Admin | Administração |
| CU13 | Assinar Premium para desbloquear limites/IA | Marcos, Eduardo | Assinaturas, Plano Premium |
| CU14 | Usar o app sem internet em uma feira | Bruno, Camila | Minha Coleção (offline) |

## 1.7. Fluxos Principais (padrão transversal)

Todo fluxo principal do produto segue o mesmo esqueleto, detalhado por módulo nas seções seguintes:

```
Gatilho → Pré-condições verificadas → Passos do usuário → Validação em tempo real →
Confirmação/Submissão → Processamento → Resultado exibido → Próxima ação sugerida
```

## 1.8. Fluxos Alternativos (padrão transversal)

Todo módulo com fluxo principal define explicitamente:
- **Caminho de saída antecipada** (usuário desiste no meio — o que é salvo como rascunho vs. descartado).
- **Caminho degradado** (sem internet, IA indisponível, permissão negada) — nunca uma tela em branco ou travada; sempre uma alternativa manual.
- **Caminho de retomada** (usuário sai e volta depois — estado é preservado quando fizer sentido).

## 1.9. Fluxos de Erro (padrão transversal)

Princípios aplicados a **todo** módulo (detalhados individualmente adiante):
- Erro de validação é mostrado **no campo**, no momento em que ocorre — nunca apenas em um resumo genérico no topo.
- Erro de rede/servidor nunca descarta o que o usuário já digitou.
- Mensagens de erro nunca expõem detalhe técnico (stack trace, código SQL) — linguagem humana, acionável, em pt-BR.
- Toda ação destrutiva (excluir item, cancelar anúncio, sair de uma troca) exige confirmação explícita antes de executar.

## 1.10. Regras de Negócio Transversais

Estas regras se aplicam a mais de um módulo e são referenciadas por nome (`RN-XX`) nas seções seguintes, para evitar repetição:

- **RN-01 — Propriedade do dado:** todo item de coleção pertence a exatamente um usuário (`owner_id`); nenhuma ação de outro usuário pode alterar dados de um item que não é seu, mesmo em trocas/vendas (a transferência de propriedade é uma operação atômica e auditada, não uma edição direta).
- **RN-02 — Visibilidade em 3 níveis:** todo item/coleção tem visibilidade `private`, `collection_only` ou `public`; mudar a visibilidade nunca expõe retroativamente dado que o usuário não confirmou explicitamente (padrão é sempre o nível mais restritivo).
- **RN-03 — Item de catálogo vs. exemplar pessoal:** o "o que é" (catálogo mestre) é sempre separado do "o exemplar que eu tenho" (item de coleção); editar um nunca sobrescreve o outro.
- **RN-04 — Ação sensível é auditada:** qualquer ação que mude propriedade, dinheiro, papel de usuário ou visibilidade pública é registrada de forma imutável e pode ser consultada pelo próprio usuário no seu histórico.
- **RN-05 — Offline não é bloqueio:** consultar a própria coleção e catalogar um novo item nunca dependem de conexão; ações que dependem de outro usuário (chat, marketplace, trocas) são as únicas que exigem conexão, e o app comunica isso claramente.
- **RN-06 — Limites por plano:** limites de quantidade (itens, análises de IA por mês, fotos por item) são sempre comunicados **antes** de o usuário bater no limite, nunca como uma falha surpresa no meio de uma ação.
- **RN-07 — Reversibilidade:** toda exclusão de conteúdo de negócio (item, coleção, anúncio) é reversível por um período (soft delete) antes de ser definitiva, exceto onde a lei ou a integridade transacional exigirem o contrário (ex.: transação de venda concluída).
- **RN-08 — Confiança em transação:** nenhuma troca ou venda é considerada concluída sem confirmação explícita das duas partes; nenhuma parte pode reverter unilateralmente após confirmação mútua.

---

# 2. Módulo — Cadastro

**Objetivo:** permitir que uma pessoa crie uma conta no Numisphere da forma mais rápida possível, coletando apenas o mínimo necessário para começar a catalogar, sem sacrificar segurança.

**Quem pode acessar:** qualquer visitante não autenticado.

**Fluxo completo:**
1. Visitante toca em "Criar conta" (na landing ou no prompt de instalação do PWA).
2. Preenche: e-mail, senha, nome de usuário, nome de exibição.
3. Sistema valida em tempo real (força de senha, disponibilidade de username).
4. Visitante confirma → conta criada, sessão iniciada imediatamente (usuário não espera confirmação de e-mail para começar a explorar).
5. E-mail de verificação é enviado em paralelo; banner discreto lembra de verificar, sem bloquear o uso básico.
6. Onboarding leve de 3 telas (pulável): "adicione seu primeiro item", "explore o catálogo", "convide amigos" — usuário pode pular direto para o app.
7. Usuário cai na tela "Minha Coleção" vazia, com CTA principal "Adicionar item".

**Fluxo alternativo — Cadastro social (Google/Apple):**
1. Visitante toca em "Continuar com Google/Apple".
2. Autorização no provedor → conta criada automaticamente com dados do provedor.
3. Sistema solicita apenas a escolha de **username** (único dado obrigatório não fornecido pelo provedor) antes de liberar o app.

**Validações:**
- E-mail: formato válido; verificação de unicidade assíncrona (mensagem "Este e-mail já está em uso" sem confirmar se é conta ativa, para não vazar dado).
- Senha: mínimo 10 caracteres; indicador visual de força; sem bloqueio de caracteres especiais.
- Username: 3–30 caracteres, único, sem espaços; sugestão automática de alternativa se já em uso (ex.: `thiago_numismata2`).
- Nome de exibição: obrigatório, 1–80 caracteres, sem validação de unicidade.

**Regras:** RN-06 (plano `free` é o padrão de todo cadastro novo).

**Permissões:** ação pública, sem autenticação prévia.

**Mensagens:**
- Sucesso: "Conta criada! Vamos catalogar sua primeira peça?"
- Erro de e-mail duplicado: "Não foi possível criar a conta com esses dados. Já tem uma conta? Entrar."
- Erro de rede: "Não conseguimos conectar. Verifique sua internet e tente novamente." (dados do formulário preservados)

**Estados:** formulário vazio → preenchendo → validando → enviando → sucesso (autenticado) | erro (permanece no formulário com o campo problemático destacado).

**Exceções:**
- Username escolhido é liberado por outro usuário entre a validação e o envio (condição de corrida) → erro tratado como "nome de usuário indisponível", sem travar o restante do cadastro.
- E-mail de verificação não chega → usuário pode reenviar a partir do banner, com limite de reenvio (evita abuso).

**Critérios de aceite:**
- [ ] Usuário consegue ir de "toca em criar conta" a "está dentro do app" em menos de 60 segundos no caminho feliz.
- [ ] Nenhum dado do formulário é perdido em caso de erro de rede.
- [ ] Cadastro social exige apenas 1 campo adicional (username).
- [ ] Usuário não verificado consegue catalogar itens normalmente (verificação só é exigida para ações sensíveis futuras, ex. vender).

---

# 3. Módulo — Login

**Objetivo:** permitir que um usuário existente acesse sua conta de forma rápida e seguramente, com caminho de recuperação claro se esquecer a senha.

**Quem pode acessar:** qualquer visitante não autenticado com conta existente.

**Fluxo completo:**
1. Visitante informa e-mail e senha (ou usa login social).
2. Sistema valida credenciais.
3. Se MFA estiver ativo na conta, solicita o código de 6 dígitos.
4. Sessão iniciada → usuário vai para a última tela relevante (padrão: "Minha Coleção").

**Fluxo alternativo — Esqueci minha senha:**
1. Usuário toca em "Esqueci minha senha" na tela de login.
2. Informa e-mail → sistema sempre responde com a mesma mensagem de sucesso genérica (evita confirmar se o e-mail existe).
3. Se o e-mail existir, recebe link de redefinição válido por 1 hora.
4. Define nova senha → todas as sessões ativas da conta são encerradas por segurança → precisa logar novamente com a nova senha.

**Fluxo alternativo — "Lembrar de mim" / sessão persistente:**
- Padrão do PWA: sessão persiste via refresh token até logout explícito ou expiração por inatividade (30 dias).

**Validações:**
- Campos obrigatórios não vazios antes de habilitar o botão de envio.
- Código MFA: exatamente 6 dígitos numéricos.

**Regras:** proteção contra força bruta — após tentativas malsucedidas consecutivas, atraso progressivo é aplicado antes da próxima tentativa ser aceita (o usuário vê "Muitas tentativas. Tente novamente em alguns minutos.", nunca um erro técnico).

**Permissões:** ação pública.

**Mensagens:**
- Erro de credencial: "E-mail ou senha incorretos." (mensagem idêntica para e-mail inexistente ou senha errada — nunca revela qual campo está errado).
- Erro de MFA: "Código inválido ou expirado. Tente novamente."
- Bloqueio temporário: "Muitas tentativas de login. Tente novamente em alguns minutos."

**Estados:** formulário → validando → autenticado | erro de credencial | MFA pendente | bloqueado temporariamente.

**Exceções:**
- Conta com e-mail não verificado ainda pode logar normalmente (verificação não é bloqueante — ver Cadastro).
- Conta suspensa por moderação: login é aceito, mas usuário é direcionado a uma tela de "conta suspensa" explicando o motivo e o caminho de contestação, sem acesso ao restante do app.

**Critérios de aceite:**
- [ ] Nenhuma mensagem de erro revela se um e-mail está ou não cadastrado.
- [ ] Login social funciona em 1 toque para conta já existente.
- [ ] Redefinição de senha encerra todas as sessões antigas.
- [ ] MFA, quando ativo, é sempre solicitado — nunca contornável.

---

# 4. Módulo — Minha Coleção

**Objetivo:** ser o hub central onde o usuário vê, organiza e acompanha tudo o que já catalogou — a tela mais visitada do produto.

**Quem pode acessar:** o dono da coleção (dados completos); qualquer visitante, se a coleção/itens forem públicos (dados de visualização, sem ações de edição).

**Fluxo completo:**
1. Usuário abre o app → cai em "Minha Coleção" (tela inicial pós-login).
2. Vê resumo: número total de itens, valor estimado agregado, coleções nomeadas (pastas), atalho para "Adicionar item".
3. Pode alternar entre visão por coleção nomeada e visão de todos os itens.
4. Pode buscar, filtrar (tipo, país, material, se está à venda/troca) e ordenar (mais recente, valor, alfabético).
5. Toca em um item → vai para a ficha completa do item (fotos, dados do catálogo, grading, notas, histórico).

**Fluxo alternativo — Criar/editar/excluir coleção nomeada:**
1. Usuário cria uma "pasta" (ex.: "Moedas do Império") com nome, descrição opcional, e define se é pública.
2. Pode mover itens entre coleções a qualquer momento — item nunca fica "perdido": se a coleção é excluída, os itens voltam para a visão geral (não são excluídos).

**Fluxo alternativo — Uso offline:**
1. Sem conexão, o usuário ainda vê toda a coleção já sincronizada e pode catalogar novos itens normalmente.
2. Um indicador discreto mostra "offline — sincronizando quando reconectar".
3. Ações que dependem de outros usuários (ex.: ver ofertas recebidas) mostram estado "indisponível offline" claramente, sem parecer quebrado.

**Validações:** nome de coleção nomeada: 1–120 caracteres.

**Regras:** RN-01, RN-02, RN-03, RN-05.

**Permissões:**
- Dono: leitura e escrita completas.
- Visitante/outro usuário: leitura apenas do que é `public` (coleção e/ou item individualmente).

**Mensagens:**
- Coleção vazia: "Você ainda não tem itens aqui. Que tal adicionar o primeiro?"
- Filtro sem resultado: "Nenhum item encontrado com esses filtros."

**Estados:** vazio (novo usuário) → populado → filtrado/buscando → offline → sincronizando.

**Exceções:**
- Item com dados do catálogo mestre alterados pela curadoria depois de catalogado: o exemplar do usuário mantém seus próprios dados (nome, foto, preço) intactos; apenas a referência ao catálogo é atualizada de forma transparente (RN-03).

**Critérios de aceite:**
- [ ] Tela carrega e é utilizável em menos de 2 segundos em conexão 4G (alinhado a `PROJECT_RULES.md` §27).
- [ ] Totalmente funcional offline para consulta e adição de item.
- [ ] Nenhuma ação de edição é oferecida a um visitante não-dono, mesmo em coleção pública.

---

# 5. Módulo — Adicionar Moeda

**Objetivo:** ser o fluxo mais rápido e confiável do produto — cada segundo de fricção aqui custa retenção.

**Quem pode acessar:** qualquer usuário autenticado.

**Fluxo completo:**
1. Usuário toca em "Adicionar item" → escolhe "Moeda" (ou chega direto via Scanner IA).
2. Duas vias de entrada, sempre oferecidas lado a lado:
   - **Via catálogo:** busca o item de referência (país, ano, série) e o sistema pré-preenche material, valor de face, etc.
   - **Via manual:** usuário descreve livremente (nome, país, ano aproximado) sem vínculo ao catálogo mestre.
3. Usuário adiciona fotos (frente/verso no mínimo; borda opcional) — câmera do dispositivo é a via principal, upload de galeria é alternativa.
4. Preenche dados do exemplar: estado de conservação, data/valor de aquisição (opcionais), notas pessoais.
5. Define visibilidade (padrão: privado) e se está disponível para troca.
6. Confirma → item aparece imediatamente em "Minha Coleção".

**Fluxo alternativo — Adição em lote:**
- Usuário fotografa múltiplas moedas em sequência antes de preencher qualquer dado; sistema cria rascunhos e permite completar os dados um a um depois, sem perder as fotos já tiradas.

**Fluxo alternativo — Salvar como rascunho:**
- Se o usuário sai no meio do preenchimento, o progresso é salvo automaticamente como rascunho local, retomável a qualquer momento.

**Validações:**
- Pelo menos uma foto OU um nome (catálogo ou custom) é obrigatório para salvar (não é permitido item "vazio").
- Preço de aquisição, se informado, deve ser um número positivo.
- Data de aquisição não pode ser futura.

**Regras:** RN-03, RN-06 (plano `free` tem limite de itens/fotos por item — ver Assinaturas), RN-05 (funciona offline).

**Permissões:** o item criado pertence exclusivamente a quem o criou (RN-01).

**Mensagens:**
- Sucesso: "Item adicionado à sua coleção!"
- Limite de plano atingido: "Você atingiu o limite de {N} itens do plano gratuito. Conheça o Premium para catalogar sem limites."
- Falha ao salvar foto offline: nunca ocorre como erro — foto fica em fila local até sincronizar.

**Estados:** escolhendo tipo → buscando no catálogo (opcional) → capturando fotos → preenchendo dados → rascunho salvo → confirmado.

**Exceções:**
- Usuário tenta adicionar mais itens do que o limite do plano permite → bloqueado no passo de confirmação, nunca depois de já ter investido tempo tirando fotos e preenchendo dados (o aviso aparece assim que o limite é alcançado, de forma proativa).
- Conexão cai durante o upload de foto → foto entra na fila de sincronização offline (RN-05); o item é salvo localmente e sincronizado assim que possível.

**Critérios de aceite:**
- [ ] Fluxo completo (do toque em "Adicionar" até o item salvo) é possível em menos de 90 segundos no caminho feliz com catálogo.
- [ ] Funciona 100% offline, incluindo captura de fotos.
- [ ] Nunca é possível perder dado já preenchido por falha de conexão.

---

# 6. Módulo — Adicionar Cédula

**Objetivo:** mesmo princípio do módulo "Adicionar Moeda", adaptado aos atributos específicos de cédulas (numeração de série, assinatura, estado de conservação em escala própria de notafilia).

**Quem pode acessar:** qualquer usuário autenticado.

**Fluxo completo:**
1. Usuário toca em "Adicionar item" → escolhe "Cédula".
2. Via catálogo ou manual (mesmo padrão do módulo anterior).
3. Fotos: frente e verso obrigatórias por padrão (cédula tem menos "ângulos" que moeda — sem opção de borda).
4. Campos específicos: número de série (opcional, campo livre), assinatura/gestão (quando aplicável ao catálogo do país), estado de conservação em escala apropriada a papel-moeda.
5. Mesmo padrão de aquisição/notas/visibilidade do módulo de Moeda.
6. Confirma → item aparece em "Minha Coleção".

**Validações:**
- Mesmas regras gerais do módulo "Adicionar Moeda".
- Número de série, se informado, é tratado como texto livre (formatos variam por país/época — sem validação rígida de padrão).

**Regras:** idênticas às de "Adicionar Moeda" (RN-03, RN-05, RN-06); os dois módulos compartilham a mesma entidade de coleção por trás (`collection_items`), diferindo apenas nos campos de formulário e na escala de grading sugerida.

**Permissões:** idênticas às de "Adicionar Moeda".

**Mensagens:** idênticas em padrão às de "Adicionar Moeda", com o texto adaptado ("cédula" no lugar de "moeda").

**Estados:** idênticos ao módulo "Adicionar Moeda".

**Exceções:** mesmas do módulo "Adicionar Moeda"; adicionalmente — cédula catalogada sem verso fotografado é permitida, mas o app sinaliza a ficha como "incompleta" com um lembrete não-bloqueante (fotografar o verso ajuda avaliação futura por IA).

**Critérios de aceite:**
- [ ] Mesmos critérios do módulo "Adicionar Moeda", adaptados aos campos de cédula.
- [ ] Ficha "incompleta" (sem verso) é sinalizada visualmente, sem bloquear o salvamento.

---

# 7. Módulo — Scanner IA

**Objetivo:** eliminar a fricção de catalogação para o usuário iniciante — apontar a câmera e deixar a IA sugerir o item, ao invés de preencher formulário.

**Quem pode acessar:** qualquer usuário autenticado. Limite de análises por mês varia por plano (RN-06).

**Fluxo completo:**
1. Usuário toca no atalho "Scanner" (acesso direto da tela inicial/tab bar).
2. Câmera abre com guia visual (moldura sugerindo enquadramento da peça).
3. Usuário captura a foto (frente); sistema sugere capturar o verso em seguida para melhorar a precisão.
4. Foto(s) enviada(s) para análise de IA (módulo "Identificação IA" faz o processamento — Scanner é a porta de entrada de captura).
5. Enquanto processa, usuário vê um estado de carregamento com expectativa clara ("Analisando sua peça...").
6. Resultado leva ao fluxo de "Identificação IA".

**Fluxo alternativo — Selecionar foto existente da galeria:**
- Usuário pode pular a câmera e escolher uma foto já tirada anteriormente.

**Fluxo alternativo — Captura offline:**
- Sem conexão, a foto é capturada e enfileirada; a análise de IA roda assim que a conexão voltar (a IA é um serviço de backend — não roda no dispositivo). O usuário pode, nesse meio tempo, catalogar manualmente sem esperar a IA.

**Validações:**
- Qualidade mínima de imagem (nitidez/iluminação) verificada no cliente antes do envio; se muito ruim, sistema sugere nova captura antes de gastar uma análise do limite do plano.

**Regras:** RN-06 (consumo de cota de análises de IA por mês, conforme plano).

**Permissões:** ação individual do usuário autenticado; resultado da análise pertence a quem a solicitou.

**Mensagens:**
- Cota esgotada: "Você usou todas as suas análises de IA este mês. Elas renovam em {data} ou você pode continuar catalogando manualmente."
- Imagem de baixa qualidade: "A imagem ficou um pouco escura/desfocada. Quer tentar de novo para um resultado mais preciso?" (não bloqueia — usuário pode prosseguir mesmo assim).

**Estados:** câmera aberta → capturando → enviando → processando → resultado pronto | falha de análise (com opção de catalogar manualmente).

**Exceções:**
- IA não consegue identificar a peça com confiança suficiente → fluxo não trava; usuário é levado à catalogação manual com a(s) foto(s) já aproveitada(s).
- Falha do serviço de IA (indisponibilidade) → mensagem clara + fallback imediato para catalogação manual, nunca uma tela de erro sem saída.

**Critérios de aceite:**
- [ ] Do toque em "Scanner" à foto capturada: menos de 10 segundos de interação.
- [ ] Nunca deixa o usuário "preso" esperando IA sem alternativa manual visível.
- [ ] Funciona para iniciar a captura mesmo offline.

---

# 8. Módulo — Identificação IA

**Objetivo:** transformar a foto capturada em uma sugestão estruturada e transparente (o que é, confiança da IA, faixa de valor estimado), sempre com o usuário no controle da decisão final.

**Quem pode acessar:** qualquer usuário autenticado (fluxo geralmente iniciado pelo Scanner IA, mas também acessível a partir de um item já catalogado, para reanalisar).

**Fluxo completo:**
1. Sistema recebe a(s) foto(s) e retorna: item(ns) de catálogo mestre sugerido(s) por ordem de confiança, faixa de valor estimado (mínimo–máximo), e uma nota de confiança visível (ex.: alta/média/baixa — nunca apresentada como certeza absoluta).
2. Usuário revisa a(s) sugestão(ões) lado a lado com a própria foto.
3. Usuário escolhe: aceitar a sugestão (pré-preenche o formulário de Adicionar Moeda/Cédula), escolher outra sugestão da lista, ou descartar e catalogar manualmente do zero.
4. Segue para o formulário de confirmação (mesmo padrão de "Adicionar Moeda/Cédula"), já pré-preenchido, mas 100% editável antes de salvar.

**Fluxo alternativo — Reanalisar item existente:**
- A partir da ficha de um item já catalogado manualmente, usuário pode disparar uma análise de IA sobre as fotos já existentes (consome cota normalmente).

**Validações:** nenhuma validação adicional além das já cobertas pelo formulário de destino (Adicionar Moeda/Cédula) — a IA apenas pré-preenche, nunca salva sozinha sem confirmação do usuário.

**Regras:**
- **RN-09 — IA nunca decide sozinha:** nenhum resultado de IA é salvo na coleção do usuário sem uma ação de confirmação explícita. A IA sempre mostra o grau de confiança, nunca apresenta uma estimativa como fato definitivo.
- RN-06 (consumo de cota).

**Permissões:** resultado da análise é visível apenas a quem a solicitou.

**Mensagens:**
- Baixa confiança: "Não temos certeza sobre esta peça. Aqui estão nossas melhores hipóteses — você pode ajustar tudo antes de salvar."
- Nenhuma correspondência encontrada: "Não encontramos uma correspondência no catálogo. Vamos catalogar manualmente?"

**Estados:** processando → resultado com sugestões → sugestão aceita/trocada → formulário de confirmação → salvo.

**Exceções:**
- IA sugere um item de catálogo que não corresponde ao tipo capturado pelo usuário (ex.: cédula analisada como moeda) → usuário pode trocar o tipo manualmente no passo de confirmação sem perder as fotos já enviadas.

**Critérios de aceite:**
- [ ] Toda sugestão de IA exibe visivelmente seu nível de confiança.
- [ ] É sempre possível editar 100% dos campos pré-preenchidos antes de salvar.
- [ ] Nenhum dado é persistido na coleção sem confirmação explícita do usuário.

---

# 9. Módulo — Galeria

**Objetivo:** dar uma visão visual, tipo "álbum de fotos", da coleção do usuário — navegação rápida por imagem, complementar à lista/tabela de "Minha Coleção".

**Quem pode acessar:** dono da coleção (visão completa); visitante, apenas itens/coleções públicos.

**Fluxo completo:**
1. Usuário acessa "Galeria" a partir de "Minha Coleção" (alternância de visualização: lista ↔ galeria).
2. Vê grade de miniaturas (foto principal de cada item).
3. Pode filtrar por coleção nomeada, tipo de item, ou "com foto pendente" (itens sem foto ainda).
4. Toca em uma miniatura → abre visualização em tela cheia com zoom e navegação por swipe entre fotos do mesmo item (frente/verso/borda) e entre itens.

**Validações:** não aplicável (módulo de visualização).

**Regras:** RN-02 (respeita visibilidade item a item, não apenas da coleção-pai).

**Permissões:** leitura; edição de foto (substituir/remover) restrita ao dono, acessível a partir da visualização em tela cheia.

**Mensagens:**
- Sem fotos ainda: "Seus itens aparecerão aqui assim que tiverem fotos."

**Estados:** grade carregando (skeleton) → populada → visualização em tela cheia → vazio.

**Exceções:**
- Item com muitas fotos de alta resolução em conexão lenta → miniaturas carregam primeiro (baixa resolução), imagem em alta resolução carrega sob demanda ao abrir em tela cheia (nunca trava a grade esperando todas as imagens em qualidade máxima).

**Critérios de aceite:**
- [ ] Grade permanece fluida (sem travar scroll) mesmo com centenas de itens, via paginação/carregamento incremental.
- [ ] Zoom e swipe funcionam de forma fluida em dispositivo móvel de entrada.

---

# 10. Módulo — Favoritos

**Objetivo:** permitir marcar itens (próprios ou de outros colecionadores/marketplace) como favoritos, para acesso rápido, sem confundir com a Wishlist (que representa **intenção de aquisição**, não apenas interesse).

**Quem pode acessar:** qualquer usuário autenticado.

**Fluxo completo:**
1. Usuário toca no ícone de favorito (estrela/coração) em qualquer item visível — seu próprio, de um anúncio do Marketplace, ou de uma coleção pública de outro usuário.
2. Item é adicionado à lista de Favoritos, acessível em uma aba dedicada no Perfil.
3. Usuário pode remover o favorito a qualquer momento com o mesmo toque (toggle).

**Validações:** não aplicável.

**Regras:**
- Favoritar um item de outro usuário nunca notifica publicamente esse usuário de forma intrusiva — no máximo contribui para métricas agregadas anônimas (ex.: "item favoritado por N pessoas" no Marketplace).
- Favoritar não implica nenhuma ação de negócio (diferente de Wishlist, que pode gerar notificação de correspondência — ver módulo Wishlist em lote futuro).

**Permissões:** lista de favoritos é sempre privada ao próprio usuário — ninguém vê a lista de favoritos de outra pessoa.

**Mensagens:**
- Lista vazia: "Você ainda não favoritou nenhum item. Toque na estrela em qualquer peça para guardá-la aqui."

**Estados:** não favoritado ↔ favoritado (toggle instantâneo, otimista na UI, sincronizado em segundo plano).

**Exceções:**
- Item favoritado é excluído pelo dono original (ex.: anúncio do marketplace removido) → permanece na lista de favoritos do usuário como "indisponível", nunca desaparece silenciosamente sem explicação.

**Critérios de aceite:**
- [ ] Ação de favoritar/desfavoritar é instantânea na interface (sem espera perceptível), mesmo que a sincronização de fundo leve alguns instantes.
- [ ] Lista de favoritos nunca é visível a terceiros.

---

## Nota de progresso (remover ao concluir o documento)

Lote 1 cobre: Visão do Produto (completa) + módulos Cadastro, Login, Minha Coleção, Adicionar Moeda, Adicionar Cédula, Scanner IA, Identificação IA, Galeria, Favoritos.

Pendente para os próximos lotes:
- **Módulos:** Marketplace, Trocas, Leilões (preparado), Chat, Notificações, Perfil, Assinaturas, Plano Premium, Conquistas, Ranking, Eventos, Wishlist, Importação, Exportação, Administração.
- **Seções finais:** Mapa completo de navegação, Fluxograma do usuário, Mapa de permissões, Mapa de funcionalidades, Roadmap v1/v2/v3, Backlog inicial, MVP, Versão Comercial, Versão Enterprise.
