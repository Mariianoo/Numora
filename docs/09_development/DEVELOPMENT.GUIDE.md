# DEVELOPMENT_GUIDE.md — Numora

> **Papel deste documento:** guia operacional de desenvolvimento, consultado diariamente por todo engenheiro do time. Subordinado a `PROJECT_RULES.md` (fonte única de verdade técnica) — onde há sobreposição, este documento **detalha o "como fazer no dia a dia"**; `PROJECT_RULES.md` continua sendo a autoridade em caso de qualquer conflito. Também se apoia em `DATABASE.md`, `API_SPEC.yaml` e `SYSTEM_ARCHITECTURE.md` para contexto de schema, contrato e fluxo.
> **Escopo:** convenções de processo (Git, PR, review) e de engenharia (código, testes, ferramentas). Não contém código, apenas a especificação de padrão que todo código deve seguir.

---

## 1. Estrutura de branches

- `main` — sempre deployável, protegida (`PROJECT_RULES.md` §33.4): exige PR aprovado, CI verde, proíbe push direto/force-push.
- `feat/<escopo-curto>` — nova funcionalidade (ex.: `feat/collection-bulk-import`).
- `fix/<escopo-curto>` — correção de bug.
- `chore/<escopo-curto>` — manutenção, dependências, configuração.
- `hotfix/<escopo-curto>` — correção urgente, criada diretamente a partir de `main`/produção.
- Branches são **curtas por design** (dias, não semanas) — uma feature grande é quebrada em PRs incrementais antes de tocar código, não desenvolvida inteira em uma branch monolítica.
- Nome de branch é sempre em inglês e kebab-case, independentemente do idioma do restante do projeto (convenção universal de Git no time).

## 2. Git Flow

Modelo **trunk-based** (`PROJECT_RULES.md` §33.1), não Git Flow clássico (sem `develop`, sem branches de release de longa duração):

```
main (produção) ←── squash merge ←── feat/fix/chore (branch curta)
                                        ↑
                              rebase frequente sobre main
```

- Toda branch de trabalho começa a partir de `main` atualizada e faz rebase (não merge) de `main` periodicamente para evitar divergência grande.
- `hotfix/*` segue o mesmo fluxo, mas com prioridade de review e deploy imediato após merge.
- Nenhuma branch de "release" separada — o que está em `main` é, por definição, o que pode ir a produção a qualquer momento (suporta deploy contínuo, `PROJECT_RULES.md` §36.3).

## 3. Conventional Commits

Todo commit segue `PROJECT_RULES.md` §33.2: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `ci:`, com escopo opcional entre parênteses (`feat(collection): adicionar filtro por metal`).

**Regras adicionais operacionais:**
- Mensagem no imperativo, presente ("adicionar", não "adicionado"/"adicionando").
- Corpo do commit (quando necessário) explica o "porquê", nunca repete o "o quê" já dito no título.
- Commits intermediários de uma branch podem ser "sujos" (WIP, fixups) — o que importa é a mensagem do commit final de squash no merge (seção 4), que deve ser um Conventional Commit limpo.
- `BREAKING CHANGE:` no rodapé do commit sempre que uma mudança quebra contrato de API/schema — aciona atenção especial em code review (seção 5).

## 4. Pull Requests

- Um PR tem **escopo único e coeso** — uma feature/fix por PR (`PROJECT_RULES.md` §43.2); PR misto é recusado e dividido.
- Título do PR segue Conventional Commits (é o que vira o commit de squash em `main`).
- Descrição obrigatória: o quê, por quê, referência a issue/RFC quando aplicável, evidência de teste manual (print/gif) para mudança de UI.
- Template de PR (`.github/PULL_REQUEST_TEMPLATE.md`) inclui checklist da seção 39 deste documento como itens marcáveis.
- Squash merge é o padrão ao integrar em `main` (`PROJECT_RULES.md` §33.5) — histórico de `main` permanece linear e legível.
- PR fica em rascunho (draft) enquanto não estiver pronto para review — nunca solicita review de um PR incompleto "só para adiantar".

## 5. Code Review

- Mínimo de **1 aprovação**; **2 aprovações** para mudanças em autenticação, segurança, dados sensíveis, ou neste próprio documento/`PROJECT_RULES.md` (`PROJECT_RULES.md` §43.8).
- Review foca em **corretude, segurança e manutenibilidade** — preferência puramente estilística é resolvida por ESLint/Prettier automático (seções 23–24), nunca debatida em comentário de PR (`PROJECT_RULES.md` §28.6).
- Checklist mínimo do revisor: a lógica de negócio está em `domain`/`services`, não no componente? Há teste cobrindo o caminho novo? RLS foi considerado, se a mudança toca dado? Há regressão de performance óbvia (query N+1, bundle maior)?
- Revisor responde em até 1 dia útil (SLA interno de time) — PR parado sem review é bloqueio de fluxo do time todo, tratado com a mesma prioridade de um bug.
- Autor do PR nunca aprova o próprio PR, mesmo em caso de urgência de hotfix — pede review expresso a outro engenheiro disponível.

## 6. Padrões TypeScript

Reforça `PROJECT_RULES.md` §8 na prática diária:
- `strict: true` sempre ativo — nenhum PR desabilita regra de `tsconfig` para "fazer passar".
- `any` é tratado como *code smell* automático em review — se aparece, o revisor pergunta "por que `unknown` + narrowing não resolve aqui?" antes de aprovar.
- Todo dado de fronteira externa (formulário, resposta de API, query param) é validado com Zod (seção 19) antes de virar tipo interno — nunca `as Type`.
- Tipo é derivado de schema Zod (`z.infer`) sempre que o schema já existe — nunca duplicar manualmente.
- Funções exportadas de `services/`/`lib/` sempre declaram tipo de retorno explícito.

## 7. Padrões React

Reforça `PROJECT_RULES.md` §9:
- Componentes funcionais + Hooks, exclusivamente.
- Server Components por padrão; `"use client"` é exceção aplicada ao componente-folha mais próximo da necessidade real de interatividade — nunca "porque é mais fácil" no topo da árvore.
- Estado de servidor nunca é duplicado em `useState` — sempre via TanStack Query (seção 16).
- `useEffect` é o último recurso considerado, não o primeiro — antes de escrevê-lo, o autor verifica: isso é derivável durante o render? é um event handler? é sincronização de servidor?
- Toda lista usa `key` estável de domínio — nunca índice do array (exceto lista estática comprovadamente imutável).

## 8. Padrões Next.js

Reforça `PROJECT_RULES.md` §10:
- App Router exclusivo — nenhum código novo usa Pages Router.
- Estratégia de renderização (SSG/ISR/SSR/client) é uma decisão explícita documentada no PR quando a rota é nova, não um default acidental.
- Segredos (`SUPABASE_SERVICE_ROLE_KEY`, chaves de terceiros) só existem em Server Components, Route Handlers, Server Actions ou Edge Functions — checagem automática de CI (seção 27) bloqueia vazamento para bundle client.
- `middleware.ts` só contém: sessão/redirecionamento de auth, headers de segurança, roteamento de i18n — qualquer lógica de negócio ali é reprovada em review.

## 9. Padrões Supabase

Reforça `PROJECT_RULES.md` §11:
- Três clients (`client.ts`/`server.ts`/`admin.ts`) nunca misturados — importar `admin.ts` (`service_role`) em um caminho alcançável por requisição de usuário sem checagem de privilégio explícita é bloqueio automático de PR.
- Toda tabela nova no PR de migration tem RLS habilitado desde a primeira linha — CI falha automaticamente caso contrário (`PROJECT_RULES.md` §36.2).
- Policies escritas por operação (`select`/`insert`/`update`/`delete`) — nunca `for all` genérica sem justificativa explícita no PR.
- Alteração de schema é sempre uma migration versionada — nunca alteração manual via dashboard em ambiente compartilhado (staging/produção).

## 10. Organização das pastas

Segue exatamente `PROJECT_RULES.md` §5 — este documento não redefine estrutura, apenas reforça a regra prática: **antes de criar um arquivo, o autor confirma em qual pasta ele pertence segundo a árvore já definida** (`app/`, `components/ui`, `features/<dominio>`, `lib/`, `hooks/`, `types/`, `config/`). Um arquivo em pasta errada é motivo de solicitação de mudança em review, mesmo que o código em si esteja correto.

## 11. Organização dos componentes

- `components/ui/` — componentes "burros" (sem fetch, sem regra de negócio), reutilizáveis entre qualquer feature.
- `components/shared/` — composições reutilizáveis entre features, ainda sem lógica de domínio própria.
- `features/<dominio>/components/` — componentes específicos daquele domínio, podem consumir hooks da própria feature.
- Um componente novo só nasce em `ui/` se já houver (ou for imediatamente previsível) uso em 2+ contextos — caso contrário, começa dentro da feature e é "promovido" a `ui/` quando o segundo uso aparecer (evita abstração prematura, `PROJECT_RULES.md` §28.1).

## 12. Hooks

- Hooks de dados (`useX`) encapsulam TanStack Query (seção 16) — componente nunca chama `fetch`/Supabase diretamente, sempre via hook.
- Hooks globais (não específicos de feature) vivem em `/hooks`; hooks específicos de domínio vivem em `features/<dominio>/hooks`.
- Todo hook customizado tem um propósito nomeável em uma frase curta — hook "genérico" demais (`useStuff`) é sinal de que a responsabilidade não está clara e deve ser dividida.
- Hooks nunca escondem chamada de rede sem que o nome deixe isso óbvio (`useCollectionItems` é aceitável; `useItems` que na verdade dispara 3 requisições é enganoso).

## 13. Services

- `services/` (Application layer) orquestra casos de uso: recebe input já validado, chama repositório(s) por interface, aplica regra de autorização de negócio, retorna resultado tipado.
- Um service nunca importa diretamente `@supabase/*` — apenas repositórios (interfaces), mantendo a troca de infraestrutura possível sem tocar regra de negócio (`PROJECT_RULES.md` §4.2).
- Service é a unidade primária de teste de integração (seção 21/22) — se uma regra de negócio não está testável isoladamente via service, é sinal de acoplamento indevido a componente/UI.

## 14. Repositories

- `repositories/` (Infrastructure layer) implementa as interfaces definidas em `domain/`, traduzindo para chamadas reais ao Supabase/PostgREST.
- Um repositório é a **única** camada que sabe o nome de tabela/coluna real — mudança de schema nunca deveria exigir tocar em `services/` ou `components/`, apenas no repositório correspondente.
- Repositório nunca contém regra de negócio (validação de domínio, decisão condicional de fluxo) — apenas tradução de dado e chamada de infraestrutura.

## 15. Contexts

- React Context é reservado para estado verdadeiramente global e raro de mudar (tema, preferência de locale, sessão de usuário já resolvida) — nunca usado como substituto de TanStack Query (dado de servidor) ou Zustand (estado de UI complexo local/global).
- Todo Context novo é questionado em review: "isso não deveria ser um hook de TanStack Query ou uma store de Zustand?" antes de aceito.
- Provider de Context fica o mais próximo possível da árvore que realmente precisa dele — nunca todo Context "por garantia" no `layout.tsx` raiz.

## 16. TanStack Query

- Fonte única de estado de servidor no client — nenhum dado vindo de API é replicado manualmente em `useState`/Context.
- `staleTime`/`gcTime` definidos conscientemente por tipo de dado (dado de catálogo mestre: mais longo; dado privado de alta mutação, como mensagens: mais curto).
- Chaves de query (`queryKey`) seguem um padrão hierárquico prevbackable (ex.: `['collection-items', collectionId, filters]`) para permitir invalidação granular.
- Mutação bem-sucedida invalida exatamente as `queryKey`s afetadas — nunca um `invalidateQueries()` genérico de tudo "para garantir", que degrada performance.
- Estados de loading/error do próprio hook (`isPending`/`isError`) são sempre tratados no componente consumidor — nunca ignorados silenciosamente.

## 17. Zustand

- Reservado para estado de **UI client-side complexo** que não é estado de servidor e não é local o suficiente para um `useState` isolado (ex.: estado de um wizard de múltiplos passos, filtros complexos compartilhados entre componentes irmãos).
- Uma store por domínio de UI claro — nunca uma store global única "para tudo".
- Store nunca guarda dado de servidor já coberto por TanStack Query (evita duas fontes de verdade divergentes para o mesmo dado).

## 18. React Hook Form

- Formulário de qualquer complexidade não-trivial usa React Hook Form + resolver Zod (seção 19) — nunca estado de formulário controlado manualmente campo a campo via `useState` espalhado.
- Schema Zod do formulário é o mesmo (ou derivado) do schema de validação usado no Server Action/Route Handler correspondente — nunca duas definições de validação divergentes entre client e server.
- Mensagens de erro de campo vêm do schema Zod com mensagem já em pt-BR (alinhado a `UX_BIBLE.md` §15.2 — erro no campo, no momento, linguagem humana).

## 19. Zod

- Toda fronteira externa é validada: input de formulário, body de Route Handler/Server Action, resposta de API externa antes de uso, query params.
- Schemas vivem em `schemas/` dentro da feature correspondente, ou em `lib/validation` quando compartilhados entre features.
- Nomeação: `camelCase` com sufixo `Schema` (`createItemSchema`), conforme `PROJECT_RULES.md` §7.
- Schema é a fonte de verdade do tipo (`z.infer`) — nunca um `interface`/`type` duplicado manualmente ao lado de um schema que já cobre o mesmo formato.

## 20. Storybook

- Todo componente novo e não-trivial de `components/ui` e `components/shared` ganha uma story cobrindo: estado padrão, estados de variante relevantes (loading, erro, vazio, quando aplicável), e casos de prop extremos (texto muito longo, lista vazia).
- Story é o ambiente de desenvolvimento isolado preferido para construir um componente novo — reduz a tentação de "só terminar de ver funcionando dentro da tela real", o que tende a acoplar o componente ao contexto específico da tela.
- Storybook é também documentação viva de design system para quem só quer ver "quais componentes já existem" antes de criar um novo (reforça `PROJECT_RULES.md` §28.1 — generalizar só na repetição real, mas primeiro checar o que já existe).

## 21. Vitest

- Testes unitários/integração, conforme pirâmide de `PROJECT_RULES.md` §35.1.
- Cobertura mínima obrigatória em CI: ≥80% em `domain/` e `services/` (`PROJECT_RULES.md` §35.2).
- Teste unitário cobre: regras de domínio puras, funções de cálculo/validação, hooks com lógica não-trivial (via testing-library).
- Teste de integração cobre: repositório contra banco de teste real (Supabase local/CLI), Route Handler/Server Action com mocks controlados de camada externa.
- Nome de arquivo de teste: mesmo nome do arquivo testado + `.test.ts(x)` (`PROJECT_RULES.md` §7).
- Dado de teste é sempre sintético/fixture — nunca dado real de produção, mesmo anonimizado manualmente (`PROJECT_RULES.md` §35.7).

## 22. Playwright

- Testes E2E cobrem obrigatoriamente os fluxos críticos: cadastro/login, adicionar item à coleção, editar/excluir item, fluxo offline básico simulado, fluxo de checkout/negociação do Marketplace quando existir (`PROJECT_RULES.md` §35.5).
- Suíte E2E de smoke roda em todo PR aberto contra `main`; suíte completa roda no pipeline de deploy (`PROJECT_RULES.md` §36.1/36.3).
- Teste E2E interage com a interface como um usuário real (seletores acessíveis — role/label — nunca seletor frágil de classe CSS interna), o que também funciona como verificação indireta de acessibilidade básica.
- Testes de acessibilidade automatizados (axe) rodam como piso mínimo dentro da suíte Playwright para as páginas principais (`PROJECT_RULES.md` §35.6) — não substituem revisão manual em fluxos críticos.

## 23. ESLint

- Configuração própria estendendo `next/core-web-vitals` + `eslint-plugin-security` (`PROJECT_RULES.md` §3.2).
- Roda obrigatoriamente em CI (bloqueante) e localmente via `lint-staged` (seção 26) antes de cada commit.
- Nenhum `eslint-disable` é aceito em review sem comentário explicando o motivo na própria linha (`PROJECT_RULES.md` §8.2, aplicado de forma geral a qualquer regra desabilitada).
- Regra de import ordenado (externo → alias interno → relativo → tipos, alfabético dentro de cada bloco — `PROJECT_RULES.md` §6.2) é automatizada via plugin, nunca policiada manualmente em review.

## 24. Prettier

- Formatação automática integrada ao ESLint, execução obrigatória em pre-commit (Husky, seção 25).
- Nenhuma discussão de formatação (indentação, aspas, ponto e vírgula) acontece em code review — se Prettier permite, está correto; se um padrão incomoda o time, a config do Prettier é o lugar de mudar, não o comentário de PR individual.

## 25. Husky

- Hook `pre-commit`: roda `lint-staged` (seção 26) — bloqueia commit com erro de lint/formatação não corrigido.
- Hook `commit-msg`: valida que a mensagem de commit segue Conventional Commits (seção 3) — bloqueia commit com mensagem fora do padrão.
- Hook `pre-push` (opcional, conforme performance local do time): roda typecheck rápido antes de permitir push, para reduzir CI vermelho por erro trivial de tipo.

## 26. lint-staged

- Roda ESLint + Prettier **apenas nos arquivos staged** do commit atual (nunca no projeto inteiro, para manter o pre-commit rápido).
- Configurado para: `.ts`/`.tsx` → ESLint --fix + Prettier; `.json`/`.md`/`.yaml` → Prettier apenas.
- Falha de lint-staged bloqueia o commit localmente — nunca é aceitável "pular com `--no-verify`" exceto em emergência documentada e revertida logo em seguida (hotfix real, comunicado ao time).

## 27. CI/CD

Reforça `PROJECT_RULES.md` §36 na prática diária de desenvolvimento:
- Pipeline por PR: `install` → `lint` → `typecheck` → `test (unit+integration)` → `build` → `security scan` → `e2e smoke` (para PRs contra `main`).
- Verificação automática de RLS em toda migration nova (`PROJECT_RULES.md` §36.2) — nenhuma tabela sem RLS passa despercebida por revisor humano cansado.
- Verificação automática de segredo vazado no diff (scan de secrets) como parte do pipeline, complementando a revisão humana (seção 5).
- Deploy: PR → preview automático → aprovação → merge em `main` → deploy automático em produção → smoke test pós-deploy (`PROJECT_RULES.md` §36.3).
- Todo deploy de produção tem plano de rollback conhecido **antes** de ser executado — rollback de um clique (`PROJECT_RULES.md` §36.4), nunca improvisado sob pressão no momento do incidente.

## 28. Padrões para nomes

Reforça `PROJECT_RULES.md` §7 (tabela completa lá) — resumo de aplicação diária: componentes em `PascalCase`, hooks com prefixo `use`, funções/variáveis em `camelCase`, constantes globais em `UPPER_SNAKE_CASE`, tipos/interfaces em `PascalCase` sem prefixo `I`, tabelas/colunas de banco em `snake_case`. Nomes são sempre descritivos por extenso — abreviação obscura é reprovada em review mesmo quando "todo mundo do time entende".

## 29. Padrões de importação

- Ordem fixa (automatizada por ESLint, seção 23): bibliotecas externas → alias interno (`@/lib`, `@/features`) → imports relativos → tipos, com linha em branco entre blocos.
- Alias `@/` preferido a caminho relativo profundo (`../../../../lib/x`) sempre que a distância de pasta tornaria o relativo confuso.
- `features/<dominio>` nunca importa arquivo interno (`domain`/`repositories` privados) de outra feature — apenas o `services` público exportado dela (`PROJECT_RULES.md` §5.2).
- Import de barril (`index.ts` reexportando tudo de uma pasta) é usado com moderação — nunca a ponto de esconder de onde um símbolo realmente vem, dificultando navegação de código.

## 30. Padrões para APIs

Reforça `API_SPEC.yaml`/`API_CONVENTIONS` na implementação:
- Toda Route Handler segue o contrato já documentado no OpenAPI — divergência entre implementação e spec é tratada como bug, e a correção sempre atualiza os dois lados juntos no mesmo PR.
- Payload de entrada/saída validado por Zod espelhando exatamente o schema da spec.
- Formato de erro padronizado (`{ error: { code, message, details? } }`) é gerado por um helper central único — nunca construído manualmente endpoint a endpoint (evita divergência de formato entre rotas).
- Paginação, filtro, ordenação e busca implementam exatamente a convenção de `API_CONVENTIONS.md` (cursor-based, `filter[campo]`, `sort`, `q`) — nunca uma variação local "mais simples" para um endpoint específico.

## 31. Padrões para testes

- Todo PR que adiciona/altera lógica de negócio inclui teste correspondente — PR sem teste para lógica nova é motivo de solicitação de mudança, não uma preferência opcional do revisor.
- Nome de teste descreve comportamento esperado em linguagem natural (`it('bloqueia exclusão de item vinculado a anúncio ativo')`), não a implementação interna.
- Teste cobre pelo menos: caminho feliz, um caminho alternativo relevante, um caminho de erro — espelhando a mesma tríade usada em `USER_STORIES.md` (Casos de teste Given/When/Then).
- Mock é usado para fronteira externa (rede, tempo, IA) — nunca para mockar a própria lógica de domínio sendo testada (isso testaria o mock, não o código).

## 32. Padrões para Logs

Reforça `PROJECT_RULES.md` §17 e `SYSTEM_ARCHITECTURE.md` §24 na prática de código:
- Logging sempre via o logger estruturado central (`lib/logger`) — `console.log` em código de PR é bloqueado por ESLint (regra dedicada), nunca "esquecido sem querer" em produção.
- Nível correto escolhido conscientemente (`debug`/`info`/`warn`/`error`/`fatal`) — `error` é reservado a algo que de fato precisa de atenção, nunca usado por padrão "para garantir que apareça".
- Nenhum log inclui dado sensível bruto (seção do próprio código responsável por mascarar antes de logar, nunca confiar em filtro posterior).

## 33. Padrões para Erros

- Toda função que pode falhar de forma esperada (validação, regra de negócio) retorna um erro tipado/tratável — `throw` genérico é reservado a erro verdadeiramente excepcional/inesperado.
- `catch` nunca fica vazio nem engole a exceção silenciosamente (`PROJECT_RULES.md` §6.8) — sempre loga (seção 32) e/ou re-lança de forma intencional.
- Mensagem de erro voltada ao usuário final é sempre gerada na camada de apresentação a partir de um código de erro semântico (`VALIDATION_ERROR`, `NOT_FOUND`...) — nunca a string de exceção técnica exibida diretamente na UI.
- Error boundary (`error.tsx` do Next.js) definido por segmento de rota com ponto de falha esperado — nunca dependendo apenas do boundary genérico raiz para toda a aplicação.

## 34. Padrões para Loading

Reforça `UX_BIBLE.md` §17 na implementação:
- Toda chamada assíncrona perceptível (>~300ms) tem estado de loading tratado explicitamente no componente — nunca uma tela "congelada" sem feedback enquanto uma Promise resolve.
- Ação pontual (botão) usa estado de loading local no próprio botão (label + indicador, botão desabilitado durante o processo) — nunca um spinner de tela cheia para uma ação pequena e localizada.
- Loading de lista/tela usa Skeleton (seção 35), nunca spinner central genérico.

## 35. Padrões para Skeleton

Reforça `UX_BIBLE.md` §18:
- Skeleton é um componente reutilizável de `components/ui`, parametrizável por forma (linha de texto, card, avatar) — nunca recriado ad-hoc a cada tela nova.
- Skeleton reflete a quantidade aproximada de itens esperados na lista real (ex.: 4–6 cards), nunca um bloco único genérico.
- Transição skeleton → conteúdo real é sempre um fade curto — nunca uma troca abrupta sem transição.

## 36. Padrões para Toast

- Toast (notificação temporária não-bloqueante) é usado para sucesso "padrão" (`UX_BIBLE.md` §16.2) e para erro de ação que não justifica um estado de tela dedicado — nunca para erro crítico que impede o fluxo de continuar (esse usa estado de erro em linha, seção 33).
- Um único sistema de toast centralizado (provider único na raiz da árvore de client) — nunca implementações paralelas de toast por feature.
- Toast é sempre auto-dispensado após um tempo padrão, com opção de dispensar manualmente — nunca exige ação do usuário para sumir (exceto casos raros com ação embutida, ex.: "Desfazer").

## 37. Padrões para Modais

- Modal é reservado a decisões que realmente interrompem o fluxo (confirmação de ação destrutiva, formulário curto e contextual) — nunca usado como substituto de navegação para conteúdo extenso (isso é uma tela/rota própria).
- Todo modal é fechável via: botão explícito, tecla Esc, e clique fora (exceto quando a ação em si exige confirmação explícita antes de fechar, ex.: formulário com dado não salvo — nesse caso, confirma a intenção de descartar antes de fechar).
- Foco é preso dentro do modal enquanto aberto (focus trap) e retorna ao elemento que o abriu ao fechar — requisito de acessibilidade não-negociável (`UX_BIBLE.md` §25).
- Modal usa o nível de elevação `elevation-4` (`UX_BIBLE.md` §10) e a duração de movimento padrão de entrada/saída (`UX_BIBLE.md` §12).

## 38. Padrões para componentes reutilizáveis

- Um componente só é promovido a `components/ui`/`shared` (seção 11) quando resolve uma necessidade real já repetida — nunca criado especulativamente "porque pode ser útil depois" (`PROJECT_RULES.md` §28.1).
- Toda prop obrigatória vs. opcional é explícita na interface; variante de comportamento usa uma prop de variante tipada (`variant: 'default' | 'compact'`) em vez de explosão de props booleanas (`PROJECT_RULES.md` §29.3).
- Componente reutilizável nunca faz fetch de dado nem conhece regra de negócio — apenas recebe props e emite eventos (`PROJECT_RULES.md` §29.1).
- Toda alteração em um componente de `ui`/`shared` é avaliada quanto ao impacto em **todos** os usos existentes (Storybook, seção 20, ajuda a visualizar isso) antes do merge — um componente compartilhado não pode ser ajustado pensando em apenas um caso de uso novo às custas dos demais.

## 39. Checklist antes de Merge

- [ ] CI verde (lint, typecheck, testes, build, security scan).
- [ ] PR com escopo único, título em Conventional Commits, descrição completa (o quê/por quê/evidência).
- [ ] Teste cobrindo a lógica nova (unitário e, se aplicável, integração/E2E).
- [ ] RLS considerado e correto para qualquer tabela/policy nova ou alterada.
- [ ] Nenhum segredo exposto no diff.
- [ ] Convenções de nomenclatura, pastas e camadas respeitadas (seções 6–15).
- [ ] Nenhum `console.log`, `any` não justificado, ou código morto.
- [ ] Estados de loading/erro/vazio tratados na UI, quando aplicável (seções 33–35).
- [ ] Acessibilidade básica considerada em qualquer mudança de UI (teclado, contraste, labels).
- [ ] Pelo menos 1 aprovação de review (2 para área sensível — seção 5).
- [ ] Impacto em performance avaliado (bundle, queries novas) sem regressão não-justificada.

## 40. Checklist antes de Produção

Reforça `PROJECT_RULES.md` §45 (checklist de release) em nível de rotina de engenharia, complementar ao checklist de merge (seção 39), aplicado a marcos de release/lançamento:

- [ ] Todas as tabelas em produção com RLS revisado por segundo par de olhos.
- [ ] Backup com PITR habilitado e restauração testada recentemente.
- [ ] Headers de segurança/CSP validados em ambiente real.
- [ ] Rate limiting ativo nas rotas sensíveis.
- [ ] Scan de dependências sem vulnerabilidade crítica/alta em aberto.
- [ ] Monitoramento de erro e alertas de disponibilidade testados (alerta de teste disparado e recebido).
- [ ] Core Web Vitals dentro da meta, medidos em condição real.
- [ ] Teste de carga executado para o patamar de tráfego esperado.
- [ ] Plano de rollback testado e documentado para o release.
- [ ] Fluxo de exclusão/exportação de dados pessoais funcional ponta a ponta (LGPD).
- [ ] PWA instalável validado em dispositivos reais (iOS e Android).
- [ ] Variáveis de ambiente de produção revisadas (nenhum valor de staging vazado).
- [ ] Responsável de comunicação de incidente definido para as primeiras horas pós-lançamento.
