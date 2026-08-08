# PROJECT_RULES.md — NUMISPHERE

> **Status:** Documento vivo — fonte única de verdade (Single Source of Truth) do projeto.
> **Versão:** 1.0.0
> **Última atualização:** 2026-07-31
> **Mantenedor:** Arquitetura de Software
> **Escopo:** Este documento rege TODAS as decisões técnicas, de processo e de produto do NUMISPHERE. Qualquer código, PR, ou decisão que contradiga este documento deve ser rejeitada até que o documento seja atualizado via processo formal de RFC (ver seção 33).

---

## Sumário

1. [Objetivos do Projeto](#1-objetivos-do-projeto)
2. [Visão do Produto](#2-visão-do-produto)
3. [Tecnologias Oficiais](#3-tecnologias-oficiais)
4. [Arquitetura](#4-arquitetura)
5. [Estrutura Completa das Pastas](#5-estrutura-completa-das-pastas)
6. [Convenções de Código](#6-convenções-de-código)
7. [Padrões de Nomenclatura](#7-padrões-de-nomenclatura)
8. [Padrões TypeScript](#8-padrões-typescript)
9. [Padrões React](#9-padrões-react)
10. [Padrões Next.js](#10-padrões-nextjs)
11. [Padrões Supabase](#11-padrões-supabase)
12. [Padrões PostgreSQL](#12-padrões-postgresql)
13. [Regras de Segurança](#13-regras-de-segurança)
14. [Regras OWASP](#14-regras-owasp)
15. [Política de Autenticação](#15-política-de-autenticação)
16. [Política de Autorização](#16-política-de-autorização)
17. [Política de Logs](#17-política-de-logs)
18. [Política de Auditoria](#18-política-de-auditoria)
19. [Estratégia de Backup](#19-estratégia-de-backup)
20. [Estratégia de Cache](#20-estratégia-de-cache)
21. [Estratégia Offline](#21-estratégia-offline)
22. [Estratégia PWA](#22-estratégia-pwa)
23. [Estratégia Mobile First](#23-estratégia-mobile-first)
24. [Estratégia Desktop](#24-estratégia-desktop)
25. [Acessibilidade WCAG](#25-acessibilidade-wcag)
26. [SEO](#26-seo)
27. [Performance](#27-performance)
28. [Boas Práticas](#28-boas-práticas)
29. [Regras para Componentes](#29-regras-para-componentes)
30. [Regras para Páginas](#30-regras-para-páginas)
31. [Regras para APIs](#31-regras-para-apis)
32. [Organização do Banco](#32-organização-do-banco)
33. [Convenções Git](#33-convenções-git)
34. [Versionamento](#34-versionamento)
35. [Testes](#35-testes)
36. [CI/CD](#36-cicd)
37. [Monitoramento](#37-monitoramento)
38. [Observabilidade](#38-observabilidade)
39. [Internacionalização](#39-internacionalização)
40. [Escalabilidade](#40-escalabilidade)
41. [LGPD](#41-lgpd)
42. [Política de Dependências](#42-política-de-dependências)
43. [Critérios para Aceitar Pull Requests](#43-critérios-para-aceitar-pull-requests)
44. [Checklist de Qualidade](#44-checklist-de-qualidade)
45. [Checklist Antes de Produção](#45-checklist-antes-de-produção)

---

## 1. Objetivos do Projeto

1.1. Construir um **SaaS PWA** (Progressive Web App) para colecionadores de **moedas, cédulas, medalhas e tokens**, cobrindo catalogação, avaliação, gestão de coleção, negociação/troca e comunidade.

1.2. Suportar **milhões de usuários simultâneos** sem reescrita arquitetural — a arquitetura deve ser "escalável desde o dia 1", mesmo que a infraestrutura inicial seja dimensionada para uma fração da carga-alvo.

1.3. Entregar uma experiência **mobile-first**, instalável (PWA), com funcionamento **offline-first** parcial para funcionalidades de consulta e catalogação pessoal.

1.4. Garantir **segurança de nível bancário** para dados de coleção (que representam valor financeiro real) e para dados pessoais dos usuários, em conformidade com a **LGPD**.

1.5. Manter uma base de código **previsível, tipada, testável e auditável**, de forma que qualquer engenheiro novo consiga contribuir com segurança em menos de 5 dias úteis.

1.6. Garantir que toda funcionalidade nova respeite os pilares: **Segurança > Consistência de Dados > Performance > Experiência > Velocidade de entrega**, nesta ordem de prioridade em caso de conflito.

1.7. Não é objetivo deste documento definir roadmap de features, precificação ou estratégia de go-to-market — apenas as regras técnicas e de engenharia.

---

## 2. Visão do Produto

2.1. **Proposta de valor:** o NUMISPHERE é o "cofre digital + enciclopédia + comunidade" do colecionador de numismática e notafilia. Ele permite catalogar itens com fotos, dados técnicos (ano, país, metal, tiragem, estado de conservação — grading), acompanhar valorização estimada, e conectar-se com outros colecionadores.

2.2. **Personas principais:**
 - Colecionador iniciante (foco em catalogação simples e aprendizado).
 - Colecionador avançado/investidor (foco em avaliação, grading, histórico de mercado).
 - Negociante/lojista (foco em inventário, vitrine pública, transações).

2.3. **Princípios de produto:**
 - Confiabilidade de dados acima de tudo — um item mal catalogado ou um valor incorreto quebra a confiança do usuário.
 - Simplicidade progressiva: funcionalidades avançadas não podem atrapalhar o fluxo básico de "adicionar item à coleção".
 - Funciona bem com conexão ruim (contexto real de uso: feiras, exposições, subsolos).

2.4. **Fora de escopo (não é objetivo do produto):**
 - Não é uma casa de leilões nem processa pagamentos diretamente entre usuários na v1.
 - Não é uma rede social genérica — comunidade é funcionalidade de suporte, não o core.

---

## 3. Tecnologias Oficiais

Esta é a **stack oficial e exclusiva**. Nenhuma biblioteca, framework ou serviço fora desta lista pode ser adotado sem passar pelo processo de RFC (seção 33) e atualização deste documento.

### 3.1. Core
| Camada | Tecnologia | Observação |
|---|---|---|
| Linguagem | TypeScript (strict mode) | Proibido `.js`/`.jsx` em código de aplicação |
| Framework Web | Next.js (App Router) | SSR/SSG/ISR conforme seção 10 |
| UI Library | React | Sempre via Next.js, nunca standalone |
| Estilização | Tailwind CSS + design tokens próprios | Sem CSS-in-JS runtime |
| Componentes base | shadcn/ui (copiado, não instalado como dependência opaca) | Customizado ao design system do produto |
| Backend/BaaS | Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) | Fonte única de dados |
| Banco de dados | PostgreSQL (gerenciado via Supabase) | Ver seção 12 |
| Cache/Fila | Redis gerenciado (ex: Upstash) | Ver seção 20 |
| Hospedagem Frontend | Vercel (ou equivalente compatível com Next.js) | Edge Network obrigatório |
| CDN de mídia | Supabase Storage + CDN / provedor de imagens otimizadas | Ver seção 27 |

### 3.2. Qualidade e ferramentas
- **Gerenciador de pacotes:** pnpm (obrigatório — proibido npm/yarn em package-lock, para consistência de lockfile).
- **Lint:** ESLint com config própria estendendo `next/core-web-vitals` + regras de segurança (`eslint-plugin-security`).
- **Formatação:** Prettier (integrado ao ESLint, execução obrigatória em pre-commit).
- **Testes:** Vitest (unitário/integração) + Playwright (E2E).
- **Validação de schema:** Zod (fronteira obrigatória entre input externo e domínio).
- **Gerenciamento de estado servidor:** TanStack Query.
- **Gerenciamento de estado cliente local:** Zustand (apenas quando estado server-side não resolve).
- **Formulários:** React Hook Form + Zod resolvers.
- **Datas:** date-fns (proibido `moment.js`).
- **Ícones:** lucide-react.
- **PWA:** `next-pwa`/Service Worker customizado com Workbox.
- **Observabilidade:** Sentry (erros) + provedor de métricas/logs (ver seção 37/38).
- **CI/CD:** GitHub Actions.
- **Infra as Code (quando aplicável):** Terraform para recursos fora do Supabase/Vercel.

### 3.3. Proibições explícitas
- Proibido ORMs pesados que escondam SQL (ex.: uso irrestrito de abstrações que impeçam auditoria de query). Uso permitido de query builder tipado (ex.: Kysely) sobre o client Supabase, quando necessário.
- Proibido `any` implícito ou explícito sem justificativa documentada (ver seção 8).
- Proibido dependências não mantidas há mais de 18 meses sem avaliação de risco.
- Proibido múltiplas bibliotecas concorrentes para o mesmo propósito (ex.: dayjs e date-fns juntos).

---

## 4. Arquitetura

4.1. **Modelo geral:** Arquitetura **serverless, orientada a Edge**, com Next.js App Router atuando como camada de apresentação e orquestração, e Supabase como camada de dados/identidade/storage. Lógica de negócio sensível ou pesada roda em **Edge Functions** (Supabase) ou **Route Handlers/Server Actions** do Next.js — nunca no client.

4.2. **Camadas lógicas (Clean Architecture adaptada):**
```
Presentation (app/**)  →  Application (use-cases/services)  →  Domain (entities, regras puras)  →  Infrastructure (supabase client, apis externas)
```
 - **Domain** não conhece Supabase, React ou Next.js — é TypeScript puro e testável isoladamente.
 - **Application** orquestra casos de uso, chama repositórios (interfaces) e aplica regras de autorização.
 - **Infrastructure** implementa as interfaces de repositório usando Supabase/PostgREST/SQL.
 - **Presentation** (componentes/páginas) não acessa banco diretamente — sempre via Application.

4.3. **Multi-tenancy:** o sistema é multi-usuário com isolamento de dados via **Row Level Security (RLS)** no PostgreSQL como última linha de defesa, mesmo que a camada de aplicação já filtre por usuário/organização.

4.4. **Comunicação:**
 - Client → Server: Server Actions/Route Handlers (mutações), TanStack Query + PostgREST/RPC (leituras).
 - Realtime (ex.: notificações, chat de comunidade): Supabase Realtime (websockets) com fallback a polling.
 - Integrações externas (ex.: cotação de metais, marketplaces de referência): sempre via Edge Function intermediária — o client nunca chama API de terceiros diretamente.

4.5. **Diagrama lógico (alto nível):**
```
[PWA Client] ⇄ [Next.js Edge/App Router] ⇄ [Application/Use-Cases]
                                              ⇄ [Supabase: Auth | Postgres+RLS | Storage | Realtime | Edge Functions]
                                              ⇄ [Redis Cache]
                                              ⇄ [Serviços externos via Edge Function]
```

4.6. **Princípios arquiteturais não-negociáveis:**
 - Toda regra de negócio crítica é validada **no servidor**, independentemente de validação no client.
 - Nenhuma chave de serviço (`service_role`) do Supabase é exposta ao client, em nenhuma hipótese.
 - Toda tabela nova nasce com RLS habilitado por padrão (fail-closed).
 - Toda feature deve ser projetada assumindo que o usuário pode estar offline ou com conexão instável.

---

## 5. Estrutura Completa das Pastas

```
numisphere/
├── .github/
│   ├── workflows/                # CI/CD (lint, test, build, deploy, security scan)
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/
│   ├── PROJECT_RULES.md          # este documento
│   ├── adr/                      # Architecture Decision Records
│   └── rfcs/                     # RFCs de mudanças estruturais
├── public/
│   ├── icons/                    # ícones PWA (todas resoluções)
│   ├── manifest.webmanifest
│   └── robots.txt
├── src/
│   ├── app/                      # Next.js App Router (rotas, layouts, pages)
│   │   ├── (public)/             # rotas públicas (landing, login, marketing)
│   │   ├── (app)/                # rotas autenticadas (área logada)
│   │   ├── api/                  # Route Handlers (REST/webhooks)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                   # componentes base (shadcn customizados) — "burros", sem lógica de negócio
│   │   ├── shared/                # componentes compostos reutilizáveis entre features
│   │   └── icons/
│   ├── features/                 # organização por domínio de negócio (feature-based)
│   │   ├── collection/           # gestão de coleção do usuário
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── services/         # application layer
│   │   │   ├── repositories/     # infrastructure layer (implementações)
│   │   │   ├── domain/           # entidades e regras puras
│   │   │   ├── schemas/          # Zod schemas
│   │   │   └── types.ts
│   │   ├── catalog/              # catálogo mestre de itens numismáticos
│   │   ├── grading/              # avaliação/estado de conservação
│   │   ├── marketplace/          # vitrine/negociação
│   │   ├── community/            # fóruns, mensagens
│   │   ├── auth/
│   │   └── notifications/
│   ├── lib/
│   │   ├── supabase/             # clients (browser, server, admin) e helpers
│   │   ├── cache/                # abstrações de cache (Redis)
│   │   ├── validation/           # schemas e helpers Zod globais
│   │   ├── logger/                # abstração de logging estruturado
│   │   ├── i18n/
│   │   └── utils/
│   ├── hooks/                    # hooks globais (não específicos de feature)
│   ├── styles/
│   │   └── globals.css
│   ├── types/                     # tipos globais/compartilhados
│   ├── config/                    # configuração de app, feature flags, constantes
│   └── middleware.ts               # auth guard, headers de segurança, i18n routing
├── supabase/
│   ├── migrations/                # migrations SQL versionadas (fonte única do schema)
│   ├── functions/                 # Edge Functions
│   ├── seed.sql
│   └── config.toml
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/                        # scripts de automação (build, seed, auditoria)
├── .env.example
├── .eslintrc.cjs
├── .prettierrc
├── tsconfig.json
├── next.config.js
├── package.json
└── README.md
```

5.1. **Regra de dependência entre pastas:** `domain/` nunca importa de `repositories/`, `services/` ou `components/`. `repositories/` implementa interfaces definidas em `domain/`. `components/` nunca importa `repositories/` diretamente — apenas `services/` (via hooks).

5.2. Cada pasta de `features/<dominio>/` é um **módulo quase independente**; comunicação entre features ocorre via `services` públicos exportados, nunca importando arquivos internos de outra feature (`domain`, `repositories` internos são privados ao módulo).

---

## 6. Convenções de Código

6.1. Todo arquivo de código tem **uma responsabilidade única e clara** (Single Responsibility). Arquivos com mais de ~300 linhas devem ser avaliados para split.

6.2. **Imports organizados** em blocos, nesta ordem, separados por linha em branco: (1) bibliotecas externas, (2) alias internos (`@/lib`, `@/features`...), (3) imports relativos, (4) tipos. Ordenação alfabética dentro de cada bloco (aplicada automaticamente por ESLint).

6.3. Proibido lógica de negócio dentro de componentes de apresentação (`components/ui`). Lógica pertence a `services/`, `hooks/` ou `domain/`.

6.4. Proibido "magic numbers/strings" — extrair para constantes nomeadas em `config/constants.ts` ou no escopo do módulo.

6.5. Funções devem ser **puras sempre que possível**; efeitos colaterais (I/O, chamadas de rede, mutação de estado externo) devem ficar isolados e explícitos.

6.6. Comentários explicam **o "porquê"**, nunca o "o quê" (o código já diz o que faz). Código que precisa de comentário para explicar "o quê" deve ser reescrito para ser autoexplicativo.

6.7. Proibido código morto, `console.log` esquecido, imports não utilizados — todos barrados pelo lint em CI (falha o build).

6.8. Tratamento de erro é **explícito**: proibido `catch` vazio ou catch genérico que engole exceções sem log/re-throw intencional.

---

## 7. Padrões de Nomenclatura

| Elemento | Convenção | Exemplo |
|---|---|---|
| Pastas | kebab-case | `collection-items/` |
| Componentes React (arquivo e função) | PascalCase | `CoinCard.tsx` → `CoinCard` |
| Hooks | camelCase com prefixo `use` | `useCollectionItems.ts` |
| Funções e variáveis | camelCase | `getUserCollection()` |
| Constantes globais imutáveis | UPPER_SNAKE_CASE | `MAX_UPLOAD_SIZE_MB` |
| Tipos e Interfaces | PascalCase, sem prefixo `I` | `CollectionItem`, não `ICollectionItem` |
| Enums | PascalCase (nome) + PascalCase (membros) | `ItemCondition.MintState` |
| Zod schemas | camelCase com sufixo `Schema` | `createItemSchema` |
| Tabelas do banco | snake_case, plural | `collection_items` |
| Colunas do banco | snake_case | `created_at`, `owner_id` |
| Rotas (URLs) | kebab-case | `/minha-colecao/adicionar-item` |
| Route Handlers (arquivo) | `route.ts` (padrão Next.js) | `app/api/items/route.ts` |
| Arquivos de teste | mesmo nome + `.test.ts`/`.spec.ts` | `CoinCard.test.tsx` |
| Branches Git | ver seção 33 | `feat/collection-bulk-import` |
| Variáveis de ambiente | UPPER_SNAKE_CASE | `SUPABASE_SERVICE_ROLE_KEY` |

7.1. Nomes devem ser **descritivos e sem abreviações obscuras** (`qty` é aceitável, `qntMdCed` não é).

7.2. Booleans sempre com prefixo semântico: `is`, `has`, `should`, `can` (`isLoading`, `hasPermission`).

7.3. Funções assíncronas que representam ações de mutação usam verbo no infinitivo (`createItem`, `deleteCollection`), nunca substantivo.

---

## 8. Padrões TypeScript

8.1. `strict: true` obrigatório no `tsconfig.json`, incluindo `noUncheckedIndexedAccess`, `noImplicitAny`, `strictNullChecks`.

8.2. **Proibido `any`.** Exceções exigem `// eslint-disable-next-line @typescript-eslint/no-explicit-any` com comentário justificando o motivo, revisado obrigatoriamente no PR. Preferir `unknown` + narrowing.

8.3. Todo dado que cruza uma fronteira externa (API externa, resposta do banco antes de mapeamento, input de formulário, query params) deve ser **validado com Zod** antes de ser tratado como tipado internamente — nunca usar `as Type` para "fingir" tipagem sobre dado não confiável.

8.4. Preferir `type` para uniões/composições e `interface` para formas de objeto extensíveis (contratos de entidades/props). Consistência dentro do mesmo módulo é obrigatória.

8.5. Tipos derivados de schemas Zod via `z.infer<typeof schema>` — nunca duplicar manualmente um tipo que já existe como schema.

8.6. Proibido `enum` do TypeScript para valores que também existem no banco (Postgres enum ou check constraint) — usar `as const` + union type derivado, mantendo o banco como fonte da verdade.

8.7. Funções exportadas de módulos públicos (`services/`, `lib/`) devem ter tipo de retorno explícito (não inferido), para estabilidade de contrato.

8.8. Genéricos com nomes descritivos quando não triviais (`TEntity`, `TResponse`), não apenas `T`, exceto em utilitários genéricos simples.

---

## 9. Padrões React

9.1. Exclusivamente **componentes funcionais** com Hooks. Proibido class components.

9.2. **Server Components por padrão** (App Router); `"use client"` é exceção explícita, aplicada apenas ao componente-folha que realmente precisa de interatividade/estado/efeitos — nunca no topo da árvore "por conveniência".

9.3. Componentes de `components/ui` são **"burros"** (presentational): recebem props, não fazem fetch, não conhecem Supabase nem regras de negócio.

9.4. Lógica de dados vive em **hooks customizados** (`useX`) que encapsulam TanStack Query; componentes consomem o hook, nunca chamam `fetch`/Supabase diretamente.

9.5. **Composição sobre herança/props gigantes:** preferir `children`/slots a componentes com 15+ props condicionais.

9.6. Toda lista renderizada usa `key` estável (id de domínio), nunca índice do array, exceto listas estáticas comprovadamente imutáveis.

9.7. Estado local (`useState`) apenas para UI efêmera (aberto/fechado, valor de input não submetido). Estado de servidor nunca é duplicado em `useState` — sempre via TanStack Query cache.

9.8. `useEffect` é **último recurso**. Antes de usar, avaliar: isso pode ser derivado durante o render? Isso pertence a um event handler? Isso é sincronização de servidor (usar TanStack Query)?

9.9. Todo componente que renderiza dados assíncronos trata explicitamente os 3 estados: loading, error, empty — nunca assume "sucesso com dados" como único caminho.

9.10. Memoização (`useMemo`/`useCallback`/`memo`) é aplicada com propósito medido (profiling), não preventivamente em todo lugar.

---

## 10. Padrões Next.js

10.1. **App Router obrigatório** — proibido Pages Router em código novo.

10.2. Estratégia de renderização por rota, decidida explicitamente:
 - **Estático (SSG/ISR):** páginas de catálogo público, landing, conteúdo educativo. `revalidate` definido conscientemente.
 - **SSR dinâmico:** páginas autenticadas com dados por usuário (coleção, dashboard).
 - **Client-only:** apenas trechos interativos isolados dentro de páginas SSR.

10.3. **Server Actions** para mutações originadas de formulários/UI simples; **Route Handlers** (`app/api/**`) para endpoints consumidos por integrações externas, webhooks, ou pelo Service Worker.

10.4. `middleware.ts` centraliza: verificação de sessão/redirecionamento de auth, headers de segurança (seção 13), e roteamento de i18n. Middleware não contém regra de negócio.

10.5. Segredos (`SUPABASE_SERVICE_ROLE_KEY`, chaves de API terceiras) só existem em Server Components, Route Handlers, Server Actions ou Edge Functions — **nunca** em código marcado `"use client"` nem em variáveis `NEXT_PUBLIC_*` a menos que seja explicitamente público por design.

10.6. Uso de `next/image` obrigatório para toda imagem de conteúdo (não decorativa via CSS), com `sizes` configurado corretamente para responsividade.

10.7. Metadata (`generateMetadata`) obrigatória por rota pública, para SEO (seção 26).

10.8. Error handling via `error.tsx`/`not-found.tsx`/`global-error.tsx` em cada segmento relevante — proibido deixar o boundary padrão genérico em rotas críticas.

---

## 11. Padrões Supabase

11.1. Três clients distintos, nunca misturados:
 - `supabase/client.ts` — client browser, usa `anon key`, respeita RLS.
 - `supabase/server.ts` — client server (Server Components/Actions), usa sessão do usuário via cookies, respeita RLS.
 - `supabase/admin.ts` — client com `service_role`, **uso restrito a Edge Functions e jobs internos de confiança**, nunca importado por código que possa ser alcançado por requisição de usuário sem checagem explícita de privilégio.

11.2. **RLS habilitado em 100% das tabelas**, sem exceção, desde a migration de criação. Tabela sem RLS ativo não pode ser mergeada (barrado em CI, ver seção 36).

11.3. Policies de RLS são escritas explicitamente por operação (`select`, `insert`, `update`, `delete`) — proibido policy genérica `for all` que oculte intenção.

11.4. Toda Edge Function valida input com Zod e verifica autorização (JWT + claims/roles) antes de tocar no banco — não confia apenas na policy de RLS como única camada.

11.5. Storage (Supabase Storage): buckets separados por sensibilidade (`public-media`, `user-uploads-private`), com policies de acesso equivalentes ao rigor de RLS de tabelas.

11.6. Realtime é usado apenas para dados que genuinamente precisam de atualização ao vivo (notificações, presença, chat) — não para listagens gerais que podem usar refetch/polling via TanStack Query.

11.7. Toda alteração de schema é feita **exclusivamente via migration versionada** (`supabase/migrations`) — proibido alterar schema manualmente pelo dashboard em produção.

---

## 12. Padrões PostgreSQL

12.1. Toda tabela possui: `id` (uuid, `default gen_random_uuid()`), `created_at` (timestamptz, default `now()`), `updated_at` (timestamptz, mantido via trigger), e quando aplicável `deleted_at` (soft delete) — ver 12.5.

12.2. Chaves estrangeiras sempre com `on delete` explícito (`restrict`, `cascade` ou `set null`), decidido conscientemente por relação, nunca deixado no padrão implícito.

12.3. Índices obrigatórios em toda coluna usada em `where`, `join` ou `order by` de queries de produção; índices compostos avaliados por padrão de acesso real, não especulativamente.

12.4. Constraints de domínio aplicadas no banco (`check`, `not null`, `unique`), não apenas na aplicação — o banco é a última linha de defesa de integridade.

12.5. **Soft delete** é o padrão para entidades de negócio (itens de coleção, contas) via `deleted_at`; **hard delete** apenas para dados verdadeiramente descartáveis (ex.: tokens de sessão expirados) ou por exigência legal (ver seção 41).

12.6. Nomenclatura de constraints e índices segue padrão previsível: `idx_<tabela>_<coluna(s)>`, `fk_<tabela>_<tabela_referenciada>`, `chk_<tabela>_<regra>`.

12.7. Funções e triggers SQL documentados com comentário `COMMENT ON` explicando propósito; lógica de negócio complexa não deve migrar para dentro de triggers — preferir Edge Functions/Application layer.

12.8. Migrations são **sempre aditivas e reversíveis** em produção sempre que possível (evitar `drop column` destrutivo direto; preferir depreciar → migrar dados → remover em migration futura).

---

## 13. Regras de Segurança

13.1. **Princípio do menor privilégio** em toda camada: RLS, roles de banco, permissões de Storage, escopos de API keys.

13.2. Nenhum segredo (chave, token, senha) é commitado no repositório — uso de `.env` local (git-ignored) e secrets do provedor de CI/CD e da Vercel/Supabase em produção.

13.3. Todo input de usuário é tratado como **não confiável** até validação (Zod) e sanitização, inclusive dados vindos de "dentro" do próprio sistema (ex.: dados retornados por RPC antes de reexibição).

13.4. Headers de segurança obrigatórios em toda resposta HTTP (via `middleware.ts`/`next.config.js`): `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (ou `frame-ancestors` via CSP), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restritiva.

13.5. Upload de arquivos (fotos de itens): validação de tipo MIME real (não apenas extensão), limite de tamanho, reprocessamento/otimização server-side de imagens (nunca servir o arquivo bruto do usuário sem passar por pipeline de sanitização de imagem).

13.6. Rate limiting obrigatório em toda rota pública sensível (login, cadastro, reset de senha, endpoints de escrita públicos) via Redis (seção 20).

13.7. Toda comunicação é via **HTTPS/TLS** obrigatório — sem exceção, inclusive em ambientes internos.

13.8. Dependências são escaneadas automaticamente (Dependabot/`pnpm audit`) em CI; vulnerabilidades críticas/altas bloqueiam o merge até resolução ou mitigação documentada.

13.9. Segregação de ambientes: `local`, `staging`, `production` com credenciais e projetos Supabase **totalmente isolados** — proibido apontar ambiente de dev para banco de produção.

---

## 14. Regras OWASP

Aplicação ativa das diretrizes do **OWASP Top 10** e do **OWASP ASVS** como checklist de referência:

14.1. **Broken Access Control** → mitigado por RLS + verificação de autorização em toda Server Action/Route Handler/Edge Function (nunca confiar apenas no client para esconder UI de ação não permitida).

14.2. **Cryptographic Failures** → dados sensíveis em repouso protegidos por criptografia do provedor (Supabase/Postgres at-rest encryption); nunca armazenar senha em texto plano (delegado ao Supabase Auth); nunca logar dados sensíveis (seção 17).

14.3. **Injection** → uso exclusivo de queries parametrizadas (client Supabase/query builder tipado); proibido concatenação de string para montar SQL dinâmico.

14.4. **Insecure Design** → toda feature nova passa por análise de ameaças leve (STRIDE simplificado) antes da implementação de fluxos sensíveis (pagamento futuro, dados de valor, autenticação).

14.5. **Security Misconfiguration** → configurações padrão nunca aceitas sem revisão (buckets públicos, CORS aberto, policies permissivas); checklist de configuração revisado por ambiente.

14.6. **Vulnerable and Outdated Components** → ver seção 42 (política de dependências).

14.7. **Identification and Authentication Failures** → MFA disponível, política de senha forte, proteção contra brute-force (rate limit + lockout progressivo), rotação seguro de sessão (seção 15).

14.8. **Software and Data Integrity Failures** → CI/CD com pipeline assinado/protegido, proibição de dependências de fontes não oficiais, verificação de integridade de build.

14.9. **Security Logging and Monitoring Failures** → ver seções 17/18/37/38.

14.10. **Server-Side Request Forgery (SSRF)** → toda chamada server-side a URL fornecida por usuário (ex.: import de imagem por link) passa por validação de allowlist de domínio e resolução de IP antes da requisição.

---

## 15. Política de Autenticação

15.1. Autenticação delegada ao **Supabase Auth**, suportando: e-mail/senha, magic link, e OAuth social (Google, Apple no mínimo) — nenhuma implementação de autenticação customizada/paralela é permitida.

15.2. Senhas seguem política mínima: 10+ caracteres, verificação contra listas de senhas vazadas (quando suportado pelo provedor), sem limite artificial de complexidade que prejudique usabilidade (seguindo diretrizes NIST 800-63B).

15.3. **MFA (TOTP)** obrigatório para contas com papel administrativo/lojista verificado; opcional e incentivado para usuários comuns.

15.4. Sessões usam cookies **httpOnly, Secure, SameSite=Lax** (ou `Strict` onde não quebrar fluxo de OAuth), nunca tokens em `localStorage`.

15.5. Refresh token com rotação automática; revogação de sessão disponível ao usuário ("sair de todos os dispositivos").

15.6. Verificação de e-mail obrigatória antes de liberar ações sensíveis (venda/publicação em vitrine, alterações de dados de pagamento futuras).

15.7. Fluxo de recuperação de senha com token de uso único, expiração curta (≤ 1h), e invalidação de sessões ativas após troca de senha.

---

## 16. Política de Autorização

16.1. Modelo **RBAC** (Role-Based Access Control) com papéis mínimos: `user`, `verified_seller`, `moderator`, `admin`. Extensível a **ABAC** (regras por atributo, ex.: dono do recurso) quando RBAC puro não for suficiente.

16.2. Autorização é verificada em **três camadas redundantes**: (1) UI esconde ações não permitidas (UX), (2) Application layer valida permissão antes de executar caso de uso, (3) RLS no banco impede acesso mesmo que as camadas anteriores falhem.

16.3. Toda Server Action/Route Handler que modifica dado de outro usuário (ex.: moderação) exige checagem explícita de papel — nunca inferida implicitamente pela ausência de erro.

16.4. Claims de papel/permissão residem no JWT (custom claims via Supabase) ou em tabela `user_roles` consultada via policy — nunca confiar em papel enviado pelo client em payload de requisição.

16.5. Mudança de papel de um usuário é uma ação auditada (seção 18), nunca autoexecutável pelo próprio usuário (exceto fluxos de verificação explícitos com validação server-side).

---

## 17. Política de Logs

17.1. Logging estruturado (JSON) obrigatório via abstração central (`lib/logger`) — proibido `console.log` disperso em código de produção.

17.2. Níveis padronizados: `debug`, `info`, `warn`, `error`, `fatal`. `debug` nunca ativo em produção por padrão.

17.3. **Proibido logar dados sensíveis**: senhas, tokens, chaves, dados pessoais completos (CPF, endereço completo), conteúdo integral de cartão/pagamento (quando existir). Campos sensíveis são mascarados (`***`) antes do log.

17.4. Todo log de erro inclui: identificador de correlação (request id/trace id), contexto mínimo (rota, usuário — id, não dado pessoal), stack trace em ambiente não-produção; em produção, stack trace vai ao provedor de erro (Sentry), não ao log bruto público.

17.5. Logs têm retenção definida por criticidade (ex.: logs de aplicação 30 dias, logs de segurança/auditoria conforme seção 18/41) e são armazenados em serviço centralizado, nunca apenas em disco efêmero da função serverless.

---

## 18. Política de Auditoria

18.1. Tabela de **audit log** dedicada (`audit_logs`) registra, no mínimo: ator (user_id), ação, entidade afetada, timestamp, e diff relevante (antes/depois) para ações sensíveis.

18.2. Ações obrigatoriamente auditadas: login/logout, alteração de papel/permissão, exclusão de conta, exclusão de item de coleção, ações de moderação, alterações de dados de venda/preço em vitrine, exportação de dados pessoais (LGPD).

18.3. Registros de auditoria são **imutáveis** (sem `update`/`delete` permitido via RLS, apenas `insert`; exclusão apenas via processo administrativo controlado, com trilha própria).

18.4. Auditoria é escrita de forma **assíncrona e resiliente** (não pode bloquear nem falhar a operação principal do usuário caso a escrita do log falhe — falha de auditoria gera alerta, não erro 500 ao usuário).

18.5. Acesso à visualização dos audit logs é restrito a papéis `admin`, e o próprio acesso de leitura é, em si, auditável.

---

## 19. Estratégia de Backup

19.1. Backups automáticos do Postgres gerenciados pelo Supabase, com **Point-in-Time Recovery (PITR)** habilitado em produção assim que o plano suportar, com granularidade mínima definida por RPO alvo (seção 40).

19.2. Backups testados periodicamente com **restauração simulada em ambiente isolado** (não apenas confiar que o backup "existe") — processo documentado com frequência mínima trimestral.

19.3. Storage de mídia (fotos de itens) possui redundância própria do provedor; política de retenção de versões antigas de arquivo definida por custo/benefício.

19.4. RPO (Recovery Point Objective) e RTO (Recovery Time Objective) alvo são definidos formalmente por ambiente (produção: RPO ≤ 15 min via PITR; RTO ≤ 4h) e revisados conforme crescimento da base.

19.5. Backups contendo dados pessoais seguem os mesmos princípios de proteção da seção 41 (LGPD) — criptografados em repouso, acesso restrito.

---

## 20. Estratégia de Cache

20.1. Camadas de cache, da mais próxima do usuário à mais distante:
 - **Cache de CDN/Edge** (Vercel) para páginas estáticas/ISR e assets.
 - **Cache de aplicação (Redis)** para: resultados de queries pesadas/agregadas (ex.: rankings, cotações), sessões de rate limiting, dados semi-estáticos do catálogo mestre.
 - **Cache de cliente (TanStack Query)** para dados já buscados pelo usuário na sessão atual, com `staleTime`/`gcTime` definidos por tipo de dado.

20.2. Toda entrada de cache tem **TTL explícito** — proibido cache sem expiração "porque nunca muda" (usar invalidação por evento nesse caso, não ausência de TTL).

20.3. Invalidação de cache é feita por **evento de mutação** (ao editar um item, invalida-se a chave relacionada) sempre que o dado for crítico para consistência; cache "eventualmente consistente" só é aceitável para dados não-críticos (ex.: contadores agregados de estatísticas).

20.4. Dados por usuário (privados) nunca compartilham chave de cache entre usuários — chaves sempre namespaced por `user_id`/tenant quando aplicável.

20.5. Cache é tratado como **otimização, não fonte de verdade** — o sistema deve continuar correto (embora mais lento) caso o Redis fique indisponível (fallback gracioso).

---

## 21. Estratégia Offline

21.1. O NUMISPHERE adota **offline-first parcial**: funcionalidades de **consulta à própria coleção já sincronizada** e **catalogação de novo item** funcionam sem conexão; funcionalidades de comunidade/marketplace exigem conexão (degradação graciosa com aviso claro).

21.2. Persistência local via **IndexedDB** (através de uma camada de abstração, não acesso direto disperso pelo código) para itens de coleção do usuário logado.

21.3. Mutações feitas offline entram em uma **fila de sincronização** persistida localmente; ao reconectar, são reenviadas em ordem, com resolução de conflito definida por regra explícita (ver 21.5).

21.4. UI comunica claramente o estado: "offline", "sincronizando", "sincronizado", "conflito pendente" — nunca falha silenciosamente nem finge sucesso de uma ação que ainda não foi persistida no servidor.

21.5. Estratégia de conflito padrão: **last-write-wins com timestamp do servidor**, exceto para exclusões, onde exclusão sempre vence sobre edição concorrente (evita "ressuscitar" dado que o usuário queria remover) — documentado por entidade caso a regra padrão não sirva.

21.6. Fotos capturadas offline são armazenadas localmente (blob) e enviadas ao Storage assim que houver conexão, com indicador de progresso.

---

## 22. Estratégia PWA

22.1. **Web App Manifest** completo (`manifest.webmanifest`): nome, ícones em múltiplas resoluções (incluindo maskable), `theme_color`, `background_color`, `display: standalone`, `start_url`.

22.2. **Service Worker** via Workbox, com estratégias de cache por tipo de recurso:
 - App shell (JS/CSS/fontes): `StaleWhileRevalidate` ou `CacheFirst` com versionamento por build.
 - Imagens de itens: `CacheFirst` com expiração e limite de entradas.
 - Chamadas de API/dados: `NetworkFirst` com fallback a cache, nunca `CacheFirst` puro (dado sensível a atualização).

22.3. PWA deve passar nos critérios de **instalabilidade** (Lighthouse PWA ≥ 90) e oferecer prompt de instalação customizado e não-intrusivo (nunca interromper o fluxo principal do usuário).

22.4. Atualizações do Service Worker seguem estratégia de "atualizar e notificar" — nunca troca a versão silenciosamente no meio de uma sessão ativa sem informar o usuário (evita estado inconsistente de app).

22.5. Push Notifications (quando implementadas) usam Web Push padrão, com opt-in explícito do usuário, nunca ativadas por padrão.

---

## 23. Estratégia Mobile First

23.1. Todo desenvolvimento de UI **começa pelo breakpoint mobile** (≤ 640px) e expande progressivamente (`sm`, `md`, `lg`, `xl`, `2xl` do Tailwind) — proibido desenhar para desktop primeiro e "encolher depois".

23.2. Áreas de toque mínimas de 44x44px (diretriz de acessibilidade móvel), espaçamento suficiente entre elementos interativos adjacentes.

23.3. Fluxos críticos (adicionar item, ver coleção, login) devem ser completáveis inteiramente por **uma mão em uso**, com elementos de ação primária alcançáveis na zona inferior/central da tela.

23.4. Uso de câmera do dispositivo é fluxo de primeira classe (captura direta de foto de item), não apenas upload de arquivo genérico.

23.5. Performance mobile é o benchmark oficial de aceite de performance (seção 27), não desktop.

---

## 24. Estratégia Desktop

24.1. Em telas largas, a aplicação aproveita espaço adicional com **layouts multi-coluna** (ex.: lista + detalhe lado a lado), nunca apenas um mobile "esticado" com margens vazias.

24.2. Atalhos de teclado são fornecidos para ações frequentes em fluxos de power-user (ex.: catalogação em lote), documentados em painel de ajuda acessível.

24.3. Componentes de densidade de informação maior (tabelas, filtros avançados) são habilitados/expandidos em desktop, podendo ser simplificados/colapsados em mobile — mesma fonte de dados, apresentação adaptativa.

24.4. Suporte a drag-and-drop (ex.: upload de múltiplas fotos, reordenação) é feature desktop-enhanced, com alternativa funcional equivalente em touch.

---

## 25. Acessibilidade WCAG

25.1. Meta de conformidade: **WCAG 2.1 nível AA** como padrão mínimo obrigatório em toda feature nova.

25.2. HTML semântico obrigatório (`<button>`, `<nav>`, `<main>`, `<header>`, heading hierarchy correta) — proibido `<div onClick>` no lugar de elemento interativo nativo.

25.3. Todo elemento interativo é **navegável e operável via teclado**, com `focus-visible` claramente estilizado (nunca `outline: none` sem substituto visível).

25.4. Contraste de cor mínimo 4.5:1 para texto normal e 3:1 para texto grande/elementos gráficos, validado nos design tokens do sistema.

25.5. Imagens de conteúdo possuem `alt` descritivo; imagens puramente decorativas usam `alt=""`. Ícones sem texto adjacente possuem `aria-label`.

25.6. Formulários possuem `label` associado a cada campo, mensagens de erro anunciadas via `aria-live`/`aria-describedby`, nunca comunicadas apenas por cor.

25.7. Testado com leitor de tela (VoiceOver/NVDA) nos fluxos críticos antes de release, e via ferramentas automatizadas (axe) em CI como piso mínimo (automação não substitui teste manual em fluxos críticos).

---

## 26. SEO

26.1. Páginas públicas (catálogo, landing, conteúdo educativo) são **SSR/SSG** para garantir indexação completa — conteúdo relevante nunca depende exclusivamente de client-side rendering.

26.2. `generateMetadata` define `title`/`description` únicos e descritivos por página; proibido metadata genérica duplicada entre rotas distintas.

26.3. Dados estruturados (JSON-LD, schema.org) aplicados a páginas de item de catálogo público (ex.: `Product`/`CollectionPage` conforme aplicável).

26.4. `sitemap.xml` e `robots.txt` gerados dinamicamente, refletindo apenas conteúdo público indexável; áreas autenticadas explicitamente `disallow`.

26.5. URLs amigáveis e estáveis (kebab-case, sem IDs opacos quando evitável para conteúdo público); redirecionamentos 301 obrigatórios ao alterar uma URL pública já indexada.

26.6. Core Web Vitals (seção 27) são também critério de SEO — performance ruim é tratado como bug de SEO, não só de UX.

---

## 27. Performance

27.1. Metas de **Core Web Vitals** (medidos em mobile, rede 4G simulada) como critério de aceite: **LCP ≤ 2.5s**, **INP ≤ 200ms**, **CLS ≤ 0.1**.

27.2. Orçamento de performance (performance budget) definido por rota-tipo (ex.: página de catálogo ≤ 200KB JS inicial comprimido) e monitorado em CI via Lighthouse CI — regressão além do orçamento bloqueia merge.

27.3. Imagens sempre otimizadas (`next/image`, formatos modernos como AVIF/WebP, `lazy loading` fora do viewport inicial).

27.4. Code splitting automático por rota (nativo do Next.js) + `dynamic import` explícito para componentes pesados não críticos ao primeiro paint (ex.: editores ricos, modais complexos).

27.5. Queries ao banco otimizadas: evitar N+1 (usar `select` com joins/`in` batelado), paginação obrigatória em toda listagem (nunca `select *` sem limite em coleções que crescem sem teto).

27.6. Fontes usam `next/font` com `font-display: swap` e subsetting quando aplicável, evitando layout shift por carregamento de fonte.

---

## 28. Boas Práticas

28.1. **YAGNI/KISS** — não construir abstração genérica para um caso de uso hipotético; generalizar apenas na segunda ou terceira repetição real do padrão.

28.2. **DRY com bom senso** — duplicação leve e localizada é preferível a uma abstração prematura errada que acopla módulos que deveriam ser independentes.

28.3. Toda decisão arquitetural não-trivial é registrada como **ADR** (`docs/adr/NNNN-titulo.md`), com contexto, decisão e consequências.

28.4. Feature flags (via `config/feature-flags`) para rollout progressivo de funcionalidades de risco, permitindo desativação rápida sem rollback de deploy.

28.5. Nenhuma feature é considerada "pronta" sem: testes, tratamento de erro, estados de loading/empty, e revisão de acessibilidade básica — "funciona no meu computador" não é critério de conclusão.

28.6. Revisão de código foca em corretude, segurança e manutenibilidade — preferências puramente estilísticas são resolvidas por lint/format automático, não por debate em PR.

---

## 29. Regras para Componentes

29.1. Componentes em `components/ui` **não fazem fetch de dados, não têm estado de negócio, não conhecem o domínio** — apenas recebem props e emitem eventos.

29.2. Componentes de `features/<dominio>/components` podem consumir hooks de dados da própria feature, mas não podem importar internals de outra feature.

29.3. Props obrigatórias vs. opcionais definidas explicitamente na interface; evitar props booleanas em excesso que geram explosão combinatória de estados — preferir uma prop de variante tipada (`variant: 'default' | 'compact'`) quando aplicável.

29.4. Todo componente visual novo (não trivial) é documentado/testável isoladamente (ex.: via Storybook, se adotado, ou ao menos teste de render com casos de props relevantes).

29.5. Componentes que renderizam dados do usuário aplicam **escaping/sanitização** adequados — nunca `dangerouslySetInnerHTML` com conteúdo não sanitizado.

---

## 30. Regras para Páginas

30.1. Página (`page.tsx`) é fina: busca dados mínimos necessários (Server Component) e delega composição visual a componentes de feature — não concentra lógica de UI complexa inline.

30.2. Toda página autenticada verifica sessão/autorização **no servidor** (via middleware + checagem na própria página/layout), nunca depende apenas de esconder link no menu.

30.3. Cada página define seus próprios `loading.tsx`/`error.tsx` quando o segmento tem tempo de carregamento não-trivial ou pontos de falha esperados (ex.: chamada externa).

30.4. Parâmetros de URL e query strings são validados com Zod antes do uso — página nunca confia "cegamente" no formato de um parâmetro dinâmico.

---

## 31. Regras para APIs

31.1. Toda API (Route Handler) segue contrato REST previsível: verbo HTTP correto, status code semanticamente correto (`400` validação, `401` não autenticado, `403` não autorizado, `404` não encontrado, `409` conflito, `422` regra de negócio, `500` erro inesperado).

31.2. Payload de entrada e saída de toda API é **validado/tipado via Zod**, com schema compartilhado entre validação de request e geração de tipo de resposta quando aplicável.

31.3. Resposta de erro segue formato padronizado único em todo o sistema (ex.: `{ error: { code, message, details? } }`) — nunca formatos de erro divergentes entre endpoints.

31.4. Toda API pública (não interna) possui rate limiting e, quando aplicável, versionamento explícito na rota (`/api/v1/...`) para permitir evolução sem quebra.

31.5. Webhooks recebidos (ex.: de provedores externos futuros) validam assinatura/segredo compartilhado antes de processar qualquer payload.

31.6. Nenhuma API expõe mais dados do que o necessário para o caso de uso (evitar `select *`/serialização completa de entidade quando só alguns campos são necessários no client) — princípio de minimização de dados alinhado à seção 41.

---

## 32. Organização do Banco

32.1. Schema organizado por **domínio lógico via prefixo/schema Postgres** quando o número de tabelas justificar (ex.: `public` para core, schemas dedicados para auditoria/analytics se necessário).

32.2. Entidades centrais mínimas esperadas: `users` (gerenciado por Supabase Auth + tabela `profiles` de extensão), `collection_items`, `catalog_items` (catálogo mestre de referência), `collections` (agrupamento, se suportado), `grading_records`, `marketplace_listings`, `audit_logs`, `user_roles`.

32.3. Catálogo mestre (`catalog_items` — dados de referência de moedas/cédulas/medalhas conhecidas) é **normalizado e separado** dos itens pessoais do usuário (`collection_items`), que referenciam o catálogo mas guardam também dados específicos do exemplar do usuário (fotos, estado, notas).

32.4. Toda tabela de relação N:N usa tabela associativa explícita e nomeada semanticamente (não apenas `entity1_entity2`) quando a relação carrega atributos próprios.

32.5. Migrations são a **única fonte de verdade do schema** — qualquer diagrama ER em `docs/` é gerado/derivado das migrations, nunca mantido manualmente como fonte independente (risco de divergência).

---

## 33. Convenções Git

33.1. Modelo de branching: **trunk-based com branches de feature curtas**.
 - `main` — sempre deployável, protegida.
 - `feat/<escopo-curto>` — nova funcionalidade.
 - `fix/<escopo-curto>` — correção de bug.
 - `chore/<escopo-curto>` — manutenção, dependências, config.
 - `hotfix/<escopo-curto>` — correção urgente direto a partir de produção.

33.2. Commits seguem **Conventional Commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `ci:`, com escopo opcional (`feat(collection): adicionar filtro por metal`).

33.3. Mudanças estruturais/arquiteturais relevantes (nova dependência core, mudança de padrão descrita neste documento) exigem **RFC** em `docs/rfcs/`, aprovado por pelo menos um Arquiteto/Tech Lead antes da implementação.

33.4. `main` é protegida: exige PR aprovado, checks de CI verdes (lint, testes, build, scan de segurança), e proíbe push direto/force-push.

33.5. Squash merge é o padrão ao integrar feature branches em `main`, mantendo histórico linear e legível.

---

## 34. Versionamento

34.1. O produto (release) segue **Versionamento Semântico (SemVer)** — `MAJOR.MINOR.PATCH` — para marcos de release, mesmo em contexto de deploy contínuo (tags de release, não necessariamente todo deploy).

34.2. `MAJOR`: mudança que quebra compatibilidade de API pública/contrato de integração. `MINOR`: nova funcionalidade compatível. `PATCH`: correção compatível.

34.3. APIs públicas versionadas explicitamente na rota (`/api/v1`) — mudança breaking exige nova versão convivendo com a anterior por período de depreciação anunciado.

34.4. `CHANGELOG.md` mantido e atualizado a cada release relevante, categorizado por tipo de mudança (Added/Changed/Fixed/Removed/Security).

34.5. Migrations de banco são versionadas cronologicamente pelo próprio mecanismo do Supabase CLI, nunca renomeadas/reordenadas após aplicadas em qualquer ambiente compartilhado.

---

## 35. Testes

35.1. **Pirâmide de testes** como guia: muitos testes unitários (domain/services), quantidade moderada de testes de integração (repositórios + banco de teste), poucos porém críticos testes E2E (fluxos principais de usuário).

35.2. Cobertura mínima obrigatória em CI: **≥ 80% em `domain/` e `services/`** (lógica de negócio); componentes de UI puramente visuais têm meta mais branda, mas fluxos com lógica condicional relevante são testados.

35.3. Testes unitários (Vitest) para: regras de domínio, funções de cálculo/validação, hooks com lógica não-trivial (via testing-library).

35.4. Testes de integração para: repositórios contra banco de teste real (Supabase local/CLI), Route Handlers/Server Actions com mocks controlados de camadas externas.

35.5. Testes E2E (Playwright) cobrem obrigatoriamente: cadastro/login, adicionar item à coleção, editar/excluir item, fluxo offline básico (simulado), fluxo de checkout/negociação quando existir.

35.6. Testes de acessibilidade automatizados (axe/Playwright) rodam em CI para as páginas principais como piso mínimo, sem substituir revisão manual em fluxos críticos.

35.7. Dados de teste são sempre sintéticos/fixture — **proibido usar dado real de produção** em qualquer ambiente de teste, mesmo anonimizado "manualmente" (risco de vazamento residual).

---

## 36. CI/CD

36.1. Pipeline (GitHub Actions) executado em todo PR, com estágios obrigatórios e bloqueantes: `install` → `lint` → `typecheck` → `test (unit+integration)` → `build` → `security scan (dependências + secrets)` → `e2e (smoke, em PRs para main)`.

36.2. Verificação automática de que **toda nova migration cria tabela com RLS habilitado** — pipeline falha caso detecte tabela sem RLS.

36.3. Deploy segue fluxo: PR → `staging` (preview deploy automático por PR, ex. Vercel Preview) → aprovação → merge em `main` → deploy automático em `production` com smoke test pós-deploy.

36.4. Rollback é automatizado/um-clique (reversão de deploy na Vercel + reversão de migration quando aplicável e segura) — todo deploy de produção tem plano de rollback conhecido antes de ser executado.

36.5. Segredos de CI/CD nunca aparecem em log de execução (mascarados pela plataforma); rotação periódica de segredos de deploy documentada.

---

## 37. Monitoramento

37.1. Monitoramento de disponibilidade (uptime) das superfícies críticas (app web, principais Edge Functions) com alertas automáticos em caso de indisponibilidade.

37.2. Rastreamento de erros em produção via Sentry (ou equivalente), com agrupamento por assinatura de erro, contexto de usuário (id, não PII), release/versão associada.

37.3. Dashboards de métricas de negócio essenciais (novos cadastros, itens catalogados, erros por minuto) disponíveis para o time, atualizados em tempo próximo do real.

37.4. Alertas configurados com limiares (thresholds) claros e donos definidos (quem é acionado) — proibido alerta "mudo" que ninguém recebe/trata.

37.5. Health checks (`/api/health`) expostos para verificação de dependências críticas (banco, cache) por ferramentas de monitoramento externas.

---

## 38. Observabilidade

38.1. Logging estruturado (seção 17) + tracing distribuído (correlação de request id através de Next.js → Edge Function → banco) permitindo reconstruir o caminho completo de uma requisição problemática.

38.2. Métricas técnicas coletadas: latência por rota/endpoint (p50/p95/p99), taxa de erro, throughput, latência de query de banco, hit rate de cache — com granularidade suficiente para diagnóstico sem precisar reproduzir o problema manualmente.

38.3. Toda Edge Function e Route Handler crítico emite métricas de duração e resultado (sucesso/falha) de forma consistente via a mesma abstração central, não implementações ad-hoc por endpoint.

38.4. Observabilidade é tratada como requisito de feature, não "adicionada depois" — features novas que tocam fluxo crítico (auth, pagamento futuro, catalogação) definem, no design, o que será observado.

---

## 39. Internacionalização

39.1. Idioma padrão/primário: **Português (pt-BR)**, com arquitetura de i18n preparada desde o início para expansão (ex.: `en-US`, `es`) — nunca strings de texto hardcoded fora do sistema de tradução.

39.2. Toda string visível ao usuário vive em arquivos de tradução (`lib/i18n`), referenciada por chave semântica, nunca concatenada dinamicamente de forma que quebre em outros idiomas (ordem de palavras, pluralização).

39.3. Pluralização, formatação de data/número/moeda são feitas via biblioteca de i18n consciente de locale (não `toString()`/concatenação manual) — importante dado que valores monetários/numéricos são centrais ao domínio (avaliação de itens).

39.4. Roteamento com locale (`/pt-BR/...`, `/en/...`) definido via middleware, com detecção inicial por preferência do usuário/navegador e possibilidade de troca manual persistida.

39.5. Conteúdo gerado pelo sistema (nomes de países, materiais, categorias do catálogo mestre) é armazenado de forma **normalizada/codificada** (ex.: código ISO de país), com tradução de exibição feita na camada de apresentação — nunca texto traduzido salvo como dado primário.

---

## 40. Escalabilidade

40.1. Arquitetura serverless/edge (seção 4) permite escala horizontal automática na camada de aplicação; o gargalo primário a gerenciar ativamente é o **banco de dados** — monitorado com atenção especial conforme crescimento.

40.2. Padrões que preparam para milhões de usuários desde o design: paginação obrigatória (nunca listagem "completa" sem limite), índices adequados desde a primeira migration da tabela, cache para leituras pesadas/repetitivas (seção 20), separação entre dados quentes (transacionais) e dados analíticos (que devem migrar para pipeline/read-replica dedicado quando o volume justificar).

40.3. Read replicas e/ou connection pooling (ex.: Supabase Pooler/PgBouncer) adotados assim que a carga de conexões simultâneas se aproximar dos limites do plano/infra vigente — decisão revisada por métrica real, não estimativa especulativa.

40.4. Processos pesados/assíncronos (ex.: reprocessamento em lote de imagens, geração de relatórios) rodam via fila/job (Edge Function + fila, ex. `pg_cron`/fila dedicada), nunca de forma síncrona bloqueando a requisição do usuário.

40.5. Testes de carga (ex.: k6) executados antes de marcos relevantes de crescimento/lançamento público, validando os alvos de performance da seção 27 sob concorrência realista, não apenas em uso isolado.

40.6. Design de dados evita "hot rows" de alta contenção (ex.: contadores globais atualizados a cada request) — preferir agregação assíncrona/eventual quando exatidão em tempo real não for estritamente necessária.

---

## 41. LGPD

41.1. Tratamento de dados pessoais segue os princípios da **Lei Geral de Proteção de Dados (Lei 13.709/2018)**: finalidade, adequação, necessidade, minimização de dados, transparência.

41.2. Coleta de dado pessoal sempre vinculada a uma **base legal e finalidade explícita e documentada**; nenhum campo de dado pessoal é adicionado "para o futuro" sem finalidade atual definida.

41.3. Direitos do titular implementados operacionalmente: acesso aos próprios dados, correção, portabilidade (exportação em formato estruturado), e **exclusão** — com fluxo real de atendimento a essas solicitações, não apenas política escrita sem implementação.

41.4. Exclusão de conta a pedido do titular aciona anonimização/remoção de dados pessoais identificáveis, respeitando prazos legais de retenção quando aplicável (ex.: obrigações fiscais futuras), documentando a exceção quando o dado não puder ser removido imediatamente.

41.5. Dados pessoais sensíveis (quando existirem no fluxo, ex.: documento de identidade para verificação de vendedor) são armazenados com controle de acesso restrito e criptografia adicional além do padrão de tabela comum.

41.6. Compartilhamento de dado pessoal com terceiros (processadores/subprocessadores, ex. provedor de e-mail transacional) é documentado e limitado ao estritamente necessário, com contrato/termos que garantam nível equivalente de proteção.

41.7. Política de Privacidade e Termos de Uso, visíveis e versionados, refletem com precisão o que este documento determina tecnicamente — divergência entre política pública e comportamento real do sistema é tratada como bug crítico de compliance.

41.8. Incidentes de segurança envolvendo dado pessoal seguem processo de resposta a incidente com avaliação de necessidade de comunicação à ANPD/titulares conforme exigido por lei.

---

## 42. Política de Dependências

42.1. Toda nova dependência passa por avaliação mínima antes da adoção: manutenção ativa (commits recentes), popularidade/uso na comunidade, licença compatível (permissiva — MIT/Apache/BSD; licenças copyleft fortes exigem aprovação explícita), ausência de vulnerabilidades conhecidas críticas.

42.2. Dependências redundantes (duas libs resolvendo o mesmo problema) não são permitidas — ver seção 3.3.

42.3. Atualizações de dependência são feitas de forma **contínua e incremental** (não acumular débito de versões major atrasadas); atualizações de segurança críticas (via Dependabot) têm SLA de tratamento prioritário.

42.4. Dependências com acesso privilegiado (ex.: SDKs de infraestrutura, libs que rodam server-side com acesso a segredos) recebem revisão extra de confiança/origem antes da adoção.

42.5. `pnpm-lock.yaml` é sempre commitado e é a fonte de verdade das versões exatas usadas — proibido instalação com `--no-lockfile` ou flags que ignorem o lock em qualquer ambiente além de experimentação local descartável.

---

## 43. Critérios para Aceitar Pull Requests

Um PR só pode ser aprovado e mergeado se **todos** os itens abaixo forem verdadeiros:

43.1. Todos os checks de CI estão verdes (lint, typecheck, testes, build, scan de segurança — seção 36).

43.2. O PR tem **escopo único e coeso** (uma feature/fix por PR); PRs excessivamente grandes/mistos são recusados e devem ser divididos.

43.3. Código novo/alterado possui testes correspondentes (unitários e, quando aplicável, integração) proporcionais à criticidade da mudança.

43.4. Nenhuma tabela nova sem RLS habilitado; nenhuma policy de RLS excessivamente permissiva sem justificativa explícita no PR.

43.5. Nenhum segredo, chave ou credencial exposta no diff (verificado por scan automático e revisão humana).

43.6. Convenções de nomenclatura, estrutura de pastas e camadas (Domain/Application/Infrastructure/Presentation) respeitadas conforme seções 5–9.

43.7. Descrição do PR explica **o quê** e **por quê** (não apenas "fix bug"), com referência à issue/RFC quando aplicável, e inclui evidência de teste manual para mudanças de UI (print/gif quando pertinente).

43.8. Pelo menos **uma aprovação** de outro engenheiro (dois para mudanças em áreas de segurança/autenticação/dados sensíveis ou que alterem este documento).

43.9. Impacto em performance (bundle size, queries novas) avaliado — sem regressão não-justificada além do orçamento definido na seção 27.

43.10. Impacto em acessibilidade considerado para qualquer mudança de UI nova (não apenas refatoração interna sem efeito visual).

---

## 44. Checklist de Qualidade

Checklist aplicável a toda feature antes de ser considerada "concluída" (Definition of Done):

- [ ] Regras de negócio implementadas em `domain/`/`services/`, não espalhadas em componentes.
- [ ] Validação de input com Zod em toda fronteira (formulário, API, Server Action).
- [ ] Autorização verificada no servidor (não apenas escondida na UI).
- [ ] RLS revisado/testado para qualquer tabela nova ou policy alterada.
- [ ] Estados de loading, erro e vazio tratados na UI.
- [ ] Comportamento offline considerado (ao menos degradação graciosa, quando aplicável ao fluxo).
- [ ] Responsivo mobile-first validado nos breakpoints principais.
- [ ] Acessibilidade básica validada (teclado, contraste, labels, leitor de tela nos fluxos críticos).
- [ ] Textos visíveis passam pelo sistema de i18n (sem string hardcoded).
- [ ] Logs relevantes adicionados (sem dado sensível) e auditoria aplicada se a ação for sensível.
- [ ] Testes automatizados cobrindo o caminho feliz e ao menos um caminho de erro relevante.
- [ ] Performance validada (sem regressão de bundle/queries N+1 introduzidas).
- [ ] Documentação atualizada (README do módulo/ADR, se decisão arquitetural).
- [ ] Nenhum `console.log`, `any`, ou código morto remanescente.

---

## 45. Checklist Antes de Produção

Checklist obrigatório antes de **qualquer** release marcante ou lançamento público/expansão significativa de tráfego:

- [ ] Todas as tabelas em produção com RLS habilitado e policies revisadas por segundo par de olhos.
- [ ] Backup com PITR habilitado e teste de restauração recente validado (seção 19).
- [ ] Headers de segurança e CSP validados em ambiente de produção real (não apenas local).
- [ ] Rate limiting ativo nas rotas sensíveis (login, cadastro, escrita pública).
- [ ] Scan de dependências sem vulnerabilidades críticas/altas em aberto.
- [ ] Monitoramento de erro (Sentry) e alertas de disponibilidade configurados e testados (alerta de teste disparado e recebido).
- [ ] Health check e dashboards de métricas operacionais no ar.
- [ ] Core Web Vitals dentro da meta (seção 27) medidos em condição real (não apenas ambiente de dev).
- [ ] Teste de carga executado para o patamar de tráfego esperado no lançamento, com resultado dentro do aceitável.
- [ ] Plano de rollback testado e documentado para o release em questão.
- [ ] Política de Privacidade/Termos de Uso publicados e condizentes com o tratamento de dado real do sistema (LGPD).
- [ ] Fluxo de exclusão/exportação de dados pessoais funcional e testado ponta a ponta.
- [ ] PWA instalável validado em dispositivos reais (iOS e Android, não apenas emulador).
- [ ] Variáveis de ambiente/segredos de produção revisados (nenhum valor de staging/dev vazado para produção e vice-versa).
- [ ] Comunicação de incidente/on-call definida: quem é acionado em caso de indisponibilidade nas primeiras horas pós-lançamento.

---

*Fim do documento. Toda alteração a este arquivo segue o processo de RFC descrito na seção 33.3 e deve ser aprovada por, no mínimo, um Arquiteto/Tech Lead do projeto.*
