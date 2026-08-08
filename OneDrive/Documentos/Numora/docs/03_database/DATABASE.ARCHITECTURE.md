# DATABASE_ARCHITECTURE.md — CoinVerse

> **Escopo:** Arquitetura completa do banco de dados (Supabase/PostgreSQL) do CoinVerse.
> **Referência normativa:** Este documento é subordinado ao `PROJECT_RULES.md` (fonte única de verdade do projeto). Nenhuma regra aqui contradiz as seções 11 (Padrões Supabase), 12 (Padrões PostgreSQL), 13–18 (Segurança/OWASP/Auth/Autorização/Logs/Auditoria), 19 (Backup), 20 (Cache), 32 (Organização do Banco) e 41 (LGPD) do documento mestre — este arquivo apenas as detalha ao nível de schema.
> **Fora de escopo:** SQL, migrations, código de aplicação, componentes, páginas, APIs. Documento exclusivamente de design para implementação futura.
> **Versão:** 1.0.0 · **Status:** Draft para implementação

---

## 1. Arquitetura do Banco

### 1.1. Estratégia geral
O banco é um único cluster PostgreSQL (gerenciado via Supabase), organizado logicamente em **módulos de domínio** (seção 2), todos vivendo no schema `public` por padrão, com possibilidade de schemas dedicados (`audit`, `analytics`) quando o volume justificar isolamento físico/de permissão (ver 1.9). Toda tabela nasce com **Row Level Security habilitada por padrão** (fail-closed), conforme seção 11.2 do `PROJECT_RULES.md`.

### 1.2. Separação por módulos
Cada domínio de negócio (Autenticação, Coleções, Catálogo, Marketplace, etc. — seção 2) é tratado como um **módulo de dados quase independente**: tabelas de um módulo referenciam tabelas de outro apenas via chave estrangeira explícita para entidades âncora (`profiles.id`, `catalog_items.id`), nunca duplicando lógica de outro módulo. Isso espelha a organização `features/<dominio>` da camada de aplicação (seção 5 do `PROJECT_RULES.md`), mantendo o alinhamento entre modelo de dados e modelo de código.

### 1.3. Escalabilidade (alvo: 1M+ usuários)
- **Particionamento (partitioning):** tabelas de altíssimo volume e crescimento não-limitado por usuário — `audit_logs`, `system_logs`, `user_events` (analytics), `notifications`, `messages` — são projetadas desde o início para **particionamento por range de tempo** (mensal), mesmo que a partição física seja implementada apenas quando o volume real exigir. O design de PK/índice já é compatível com partition key (`created_at` incluída na PK composta dessas tabelas).
- **Connection pooling** via Supabase Pooler (modo `transaction`) obrigatório para qualquer camada serverless com alto número de conexões concorrentes (Edge Functions, Route Handlers).
- **Read replicas** planejadas para leituras pesadas de catálogo público e analytics assim que a carga justificar, mantendo o banco primário dedicado a escrita/transações do usuário.
- **Desnormalização controlada** em pontos específicos de leitura quente (ex.: contadores de `likes`/`views` em `marketplace_listings`) via colunas materializadas atualizadas por trigger/job assíncrono, evitando `count(*)` custoso em tabelas grandes.
- **IDs:** `uuid` (v4, `gen_random_uuid()`) como padrão para chaves primárias — evita coordenação central de sequência e facilita sharding futuro, ao custo de índice levemente maior que `bigint` (aceito conscientemente pela vantagem de escalabilidade horizontal).

### 1.4. Normalização
Modelo relacional em **3ª Forma Normal (3NF)** como padrão para dados transacionais (usuários, coleções, marketplace), evitando redundância e anomalias de atualização. Exceções conscientes e documentadas (desnormalização) apenas para:
- Colunas de contagem/agregado materializado (performance de leitura).
- Snapshot de dados no momento de uma transação (ex.: `marketplace_transactions` guarda uma cópia imutável do preço/condição do item no momento da venda, mesmo que o item original mude depois) — necessário para integridade histórica, não é falha de normalização.

### 1.5. Índices
Estratégia de indexação por padrão de acesso real (não especulativa):
- Índice B-tree em toda FK usada em `join` frequente.
- Índice composto em colunas usadas juntas em filtros de listagem (ex.: `collection_items(owner_id, deleted_at)`).
- Índice `GIN` em colunas de busca textual (`catalog_items.search_vector` — `tsvector`) e em colunas `jsonb` consultadas por chave (ex.: `catalog_items.attributes`).
- Índice parcial (`WHERE deleted_at IS NULL`) em tabelas com soft delete, para manter os índices "quentes" pequenos e rápidos, já que a grande maioria das queries de produto ignora registros excluídos.
- Índice único (`UNIQUE`) sempre que a regra de negócio exigir unicidade (ver campo "Unique" de cada tabela).

### 1.6. Cache
Alinhado à seção 20 do `PROJECT_RULES.md`: o banco é a fonte de verdade; o Redis cacheia (a) resultados de leitura pesada do catálogo mestre (praticamente estático), (b) agregados calculados (rankings, estatísticas de coleção), (c) sessões de rate limiting. Nenhuma tabela transacional (coleção pessoal, marketplace, mensagens) é servida exclusivamente por cache sem fallback ao banco. Invalidação por evento de mutação nas tabelas de catálogo (`catalog_items`, `catalog_countries`, etc.).

### 1.7. Auditoria
Sistema de auditoria dedicado, detalhado na seção 6, com tabela `audit_logs` central, escrita assíncrona/resiliente (nunca bloqueia a operação principal), e imutabilidade garantida via RLS (`insert`-only para roles de aplicação).

### 1.8. Versionamento
- **Versionamento de schema:** exclusivamente via migrations do Supabase CLI (fonte única de verdade — seção 32.5 do `PROJECT_RULES.md`), nunca alteração manual via dashboard em produção.
- **Versionamento de dados de negócio:** entidades que mudam de estado ao longo do tempo e cujo histórico importa (ex.: `grading_records`, `marketplace_listings`) usam padrão **append-only de histórico** (nova linha por mudança relevante) em vez de sobrescrever o estado anterior, quando a regra de negócio exigir rastreabilidade (ex.: histórico de preço de um anúncio).

### 1.9. Storage
Detalhado na seção 4. Buckets segregados por sensibilidade e finalidade, com policies de acesso equivalentes ao rigor de RLS das tabelas, e toda referência de arquivo em tabela guarda **path relativo no bucket**, nunca URL assinada persistida (URLs assinadas são geradas sob demanda, com expiração curta).

---

## 2. Módulos do Banco

| # | Módulo | Propósito |
|---|---|---|
| A | Autenticação & Usuários | Identidade, perfis, papéis, sessões, dispositivos |
| B | Coleções | Coleções pessoais e itens catalogados pelo usuário |
| C | Catálogo Mestre | Base de referência normalizada de moedas/cédulas/medalhas/tokens |
| D | Grading | Avaliação/estado de conservação dos itens |
| E | Fotos & Mídia | Metadados de imagens e certificados vinculados a Storage |
| F | Marketplace | Anúncios, ofertas, transações, avaliações de vendedor |
| G | Trocas | Propostas de troca entre colecionadores |
| H | Assinaturas | Planos, assinaturas de usuário, transações de pagamento |
| I | IA | Requisições e resultados de reconhecimento/avaliação por IA |
| J | Mensagens | Conversas e mensagens entre usuários |
| K | Notificações | Notificações e preferências de envio |
| L | Relatórios | Denúncias/reports de conteúdo e relatórios salvos do usuário |
| M | Administração | Ações administrativas e fila de moderação |
| N | Logs & Auditoria | `audit_logs`, `system_logs`, `error_logs` |
| O | Sistema | Configuração, feature flags, versões de app |
| P | Analytics | Eventos de uso e métricas agregadas |
| Q | Gamificação | Pontos, níveis, badges |
| R | Conquistas | Definição e progresso de achievements |
| S | Wishlist | Lista de desejos do colecionador |
| T | Eventos | Feiras, exposições e encontros de colecionadores |

---

## 3. Especificação das Tabelas

> **Convenções aplicadas a todas as tabelas (não repetidas por tabela):**
> - Toda tabela possui `id uuid PK default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now() (via trigger)`.
> - Toda tabela de entidade de negócio possui `deleted_at timestamptz null` (soft delete), salvo indicação contrária explícita.
> - RLS **habilitada em 100% das tabelas**; políticas descritas por operação.
> - `owner_id`/`user_id` referencia sempre `profiles.id`, que por sua vez referencia `auth.users.id` (Supabase Auth).

### Módulo A — Autenticação & Usuários

#### `profiles`
**Descrição:** Extensão pública do usuário autenticado (`auth.users` é gerenciado pelo Supabase Auth e não é modificado diretamente).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| id | uuid | sim | — (mesmo valor de `auth.users.id`) |
| username | text | sim | — |
| display_name | text | sim | — |
| avatar_path | text | não | null |
| bio | text | não | null |
| country_code | char(2) | não | null |
| role | user_role (enum) | sim | `'user'` |
| plan_tier | subscription_tier (enum) | sim | `'free'` |
| is_verified_seller | boolean | sim | `false` |
| locale | text | sim | `'pt-BR'` |
| last_active_at | timestamptz | não | null |

**PK:** `id` (FK para `auth.users.id`, `on delete cascade`).
**FK:** `id → auth.users.id`.
**Índices:** `idx_profiles_username`, `idx_profiles_role`.
**Unique:** `username`.
**Relacionamentos:** 1:1 com `auth.users`; 1:N com praticamente todos os módulos (âncora do usuário).
**RLS:** `select` — público para campos não-sensíveis (via view segura, ver 3.x) ou próprio registro completo; `update` — apenas o próprio usuário (`auth.uid() = id`), exceto colunas `role`/`plan_tier`/`is_verified_seller` (alteráveis apenas por `service_role`/admin via Edge Function); `insert` — apenas via trigger de criação de usuário (Supabase Auth hook); `delete` — proibido (usar soft delete + fluxo LGPD).

#### `user_roles`
**Descrição:** Atribuição granular de papéis adicionais (suporta múltiplos papéis por usuário, além do papel primário em `profiles.role`).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| role | user_role (enum) | sim | — |
| granted_by | uuid | não | null |
| granted_at | timestamptz | sim | `now()` |

**PK:** composta (`user_id`, `role`).
**FK:** `user_id → profiles.id` (`cascade`); `granted_by → profiles.id` (`set null`).
**Índices:** `idx_user_roles_user_id`.
**Relacionamentos:** N:1 com `profiles`.
**RLS:** `select` — próprio usuário e admin; `insert`/`update`/`delete` — apenas `service_role`/admin (ação auditada, seção 6).

#### `user_sessions`
**Descrição:** Metadados de sessões ativas para suporte a "sair de todos os dispositivos" (token real fica no Supabase Auth; esta tabela é metadado de suporte).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| device_id | uuid | não | null |
| ip_address | inet | sim | — |
| user_agent | text | sim | — |
| revoked_at | timestamptz | não | null |
| expires_at | timestamptz | sim | — |

**PK:** `id`.
**FK:** `user_id → profiles.id` (`cascade`); `device_id → user_devices.id` (`set null`).
**Índices:** `idx_user_sessions_user_id`, `idx_user_sessions_expires_at`.
**RLS:** `select`/`delete` (revogar) — próprio usuário; `insert` — apenas via Edge Function de login (`service_role`); sem `update` direto pelo usuário.

#### `user_devices`
**Descrição:** Dispositivos reconhecidos do usuário (para push notifications e trilha de auditoria).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| device_type | device_type (enum) | sim | — |
| push_token | text | não | null |
| device_name | text | não | null |
| last_seen_at | timestamptz | sim | `now()` |

**PK:** `id`.
**FK:** `user_id → profiles.id` (`cascade`).
**Índices:** `idx_user_devices_user_id`.
**Unique:** `(user_id, push_token)`.
**RLS:** `select`/`insert`/`update`/`delete` — apenas próprio usuário.

---

### Módulo B — Coleções

#### `collections`
**Descrição:** Agrupamento nomeado de itens dentro da coleção do usuário (ex.: "Moedas do Brasil Império").

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| owner_id | uuid | sim | — |
| name | text | sim | — |
| description | text | não | null |
| is_public | boolean | sim | `false` |
| cover_photo_path | text | não | null |

**PK:** `id`. **FK:** `owner_id → profiles.id` (`cascade`).
**Índices:** `idx_collections_owner_id`, índice parcial `WHERE is_public AND deleted_at IS NULL`.
**Relacionamentos:** 1:N com `collection_items`.
**RLS:** `select` — dono ou (se `is_public`) qualquer usuário autenticado/anônimo; `insert`/`update`/`delete` — apenas dono.

#### `collection_items`
**Descrição:** Item individual pertencente à coleção do usuário — o exemplar físico que ele possui, referenciando o catálogo mestre.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| owner_id | uuid | sim | — |
| collection_id | uuid | não | null |
| catalog_item_id | uuid | não | null (item fora do catálogo mestre é permitido, cadastro livre) |
| custom_name | text | não | null (usado quando `catalog_item_id` é nulo) |
| condition_grade | text | não | null |
| acquisition_date | date | não | null |
| acquisition_price | numeric(12,2) | não | null |
| acquisition_currency | char(3) | não | `'BRL'` |
| estimated_value | numeric(12,2) | não | null |
| notes | text | não | null |
| is_for_trade | boolean | sim | `false` |
| visibility | item_visibility (enum) | sim | `'private'` |

**PK:** `id`. **FK:** `owner_id → profiles.id` (`cascade`); `collection_id → collections.id` (`set null`); `catalog_item_id → catalog_items.id` (`restrict`).
**Índices:** `idx_collection_items_owner_id`, `idx_collection_items_catalog_item_id`, `idx_collection_items_collection_id`, índice parcial `WHERE deleted_at IS NULL`.
**Relacionamentos:** N:1 com `profiles`, `collections`, `catalog_items`; 1:N com `item_photos`, `grading_records`.
**RLS:** `select` — dono, ou público conforme `visibility`; `insert`/`update`/`delete` — apenas dono.

---

### Módulo C — Catálogo Mestre

#### `catalog_countries`
**Descrição:** Países/entidades emissoras de referência.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| iso_code | char(2) | sim | — |
| name | text | sim | — |
| currency_code | char(3) | não | null |

**PK:** `id`. **Unique:** `iso_code`.
**RLS:** `select` — público (inclusive anônimo); `insert`/`update`/`delete` — apenas admin/curador de catálogo.

#### `catalog_series`
**Descrição:** Série/emissão de referência (ex.: "Cruzeiro 1942–1967").

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| country_id | uuid | sim | — |
| name | text | sim | — |
| period_start_year | int | não | null |
| period_end_year | int | não | null |

**PK:** `id`. **FK:** `country_id → catalog_countries.id` (`restrict`).
**Índices:** `idx_catalog_series_country_id`.
**RLS:** `select` — público; escrita — apenas admin/curador.

#### `catalog_items`
**Descrição:** Item de referência do catálogo mestre — a "ficha técnica" de uma moeda/cédula/medalha/token conhecida (não é o exemplar do usuário).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| item_type | catalog_item_type (enum) | sim | — |
| country_id | uuid | não | null |
| series_id | uuid | não | null |
| name | text | sim | — |
| year | int | não | null |
| material | coin_material (enum) | não | null |
| face_value | numeric(14,4) | não | null |
| mintage | bigint | não | null |
| description | text | não | null |
| attributes | jsonb | não | `'{}'` |
| search_vector | tsvector | não | (gerado automaticamente a partir de `name`/`description`) |

**PK:** `id`. **FK:** `country_id → catalog_countries.id` (`set null`); `series_id → catalog_series.id` (`set null`).
**Índices:** `idx_catalog_items_country_id`, `idx_catalog_items_series_id`, `idx_catalog_items_year`, `gin_catalog_items_search_vector` (GIN), `gin_catalog_items_attributes` (GIN em `jsonb`).
**Relacionamentos:** N:1 com `catalog_countries`/`catalog_series`; 1:N com `collection_items`, `marketplace_listings`.
**RLS:** `select` — público; `insert`/`update`/`delete` — apenas admin/curador (fluxo de contribuição da comunidade passa por `moderation_queue`, não escrita direta).

#### `catalog_mints`
**Descrição:** Casas da moeda/cunhagem de referência.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| name | text | sim | — |
| country_id | uuid | não | null |
| mint_mark | text | não | null |

**PK:** `id`. **FK:** `country_id → catalog_countries.id` (`set null`).
**RLS:** `select` — público; escrita — admin/curador.

---

### Módulo D — Grading

#### `grading_records`
**Descrição:** Histórico de avaliações de estado de conservação de um item da coleção (append-only — cada nova avaliação é uma nova linha).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| collection_item_id | uuid | sim | — |
| grading_scale | grading_scale (enum) | sim | — |
| grade_value | text | sim | — |
| graded_by | grading_source (enum) | sim | — |
| grader_user_id | uuid | não | null |
| notes | text | não | null |
| certificate_photo_path | text | não | null |

**PK:** `id`. **FK:** `collection_item_id → collection_items.id` (`cascade`); `grader_user_id → profiles.id` (`set null`).
**Índices:** `idx_grading_records_collection_item_id`.
**RLS:** `select` — dono do item ou item público; `insert` — dono do item ou `service_role` (IA/grading automatizado); `update`/`delete` — proibido (histórico imutável — correção é nova linha).

---

### Módulo E — Fotos & Mídia

#### `item_photos`
**Descrição:** Metadados de fotos de um item de coleção, vinculadas ao Storage.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| collection_item_id | uuid | sim | — |
| storage_path | text | sim | — |
| angle | photo_angle (enum) | sim | `'front'` |
| is_primary | boolean | sim | `false` |
| width | int | não | null |
| height | int | não | null |
| taken_offline | boolean | sim | `false` |

**PK:** `id`. **FK:** `collection_item_id → collection_items.id` (`cascade`).
**Índices:** `idx_item_photos_collection_item_id`.
**Unique:** `(collection_item_id, angle, is_primary)` parcial `WHERE is_primary`.
**RLS:** `select` — conforme visibilidade do item pai; `insert`/`update`/`delete` — dono do item pai.

#### `certificates`
**Descrição:** Documentos/certificados de autenticidade ou grading profissional (ex.: PDF/imagem de laudo de terceiros).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| collection_item_id | uuid | sim | — |
| issuer | text | sim | — |
| storage_path | text | sim | — |
| issued_at | date | não | null |

**PK:** `id`. **FK:** `collection_item_id → collection_items.id` (`cascade`).
**RLS:** `select`/`insert`/`update`/`delete` — dono do item.

---

### Módulo F — Marketplace

#### `marketplace_listings`
**Descrição:** Anúncio de venda de um item de coleção.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| seller_id | uuid | sim | — |
| collection_item_id | uuid | sim | — |
| price | numeric(12,2) | sim | — |
| currency | char(3) | sim | `'BRL'` |
| status | listing_status (enum) | sim | `'draft'` |
| views_count | int | sim | `0` (desnormalizado, atualizado assíncrono) |
| published_at | timestamptz | não | null |

**PK:** `id`. **FK:** `seller_id → profiles.id` (`cascade`); `collection_item_id → collection_items.id` (`restrict`).
**Índices:** `idx_marketplace_listings_seller_id`, `idx_marketplace_listings_status`, índice composto `(status, published_at)` para feed público.
**Relacionamentos:** 1:N com `marketplace_offers`; 1:1 com `marketplace_transactions` (quando concluído).
**RLS:** `select` — público quando `status = 'active'`; vendedor sempre vê os próprios; `insert`/`update` — apenas vendedor (`status` de conclusão só alterável via Edge Function transacional); `delete` — proibido (usar `status = 'cancelled'`).

#### `marketplace_offers`
**Descrição:** Proposta de valor de um comprador sobre um anúncio.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| listing_id | uuid | sim | — |
| buyer_id | uuid | sim | — |
| offer_price | numeric(12,2) | sim | — |
| status | offer_status (enum) | sim | `'pending'` |
| message | text | não | null |

**PK:** `id`. **FK:** `listing_id → marketplace_listings.id` (`cascade`); `buyer_id → profiles.id` (`cascade`).
**Índices:** `idx_marketplace_offers_listing_id`, `idx_marketplace_offers_buyer_id`.
**RLS:** `select` — comprador ou vendedor do anúncio relacionado; `insert` — qualquer usuário autenticado (exceto o próprio vendedor); `update` (aceitar/recusar) — apenas vendedor; comprador só pode `update` para cancelar a própria oferta pendente.

#### `marketplace_transactions`
**Descrição:** Registro imutável de uma venda concluída (snapshot de dados no momento da transação — ver 1.4).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| listing_id | uuid | sim | — |
| seller_id | uuid | sim | — |
| buyer_id | uuid | sim | — |
| final_price | numeric(12,2) | sim | — |
| item_snapshot | jsonb | sim | — |
| status | transaction_status (enum) | sim | `'pending'` |

**PK:** `id`. **FK:** `listing_id → marketplace_listings.id` (`restrict`); `seller_id`/`buyer_id → profiles.id` (`restrict`).
**Índices:** `idx_marketplace_transactions_seller_id`, `idx_marketplace_transactions_buyer_id`.
**RLS:** `select` — comprador ou vendedor envolvidos; `insert`/`update` — apenas `service_role` (Edge Function transacional); sem `delete`.

#### `marketplace_reviews`
**Descrição:** Avaliação de reputação entre comprador e vendedor pós-transação.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| transaction_id | uuid | sim | — |
| reviewer_id | uuid | sim | — |
| reviewee_id | uuid | sim | — |
| rating | smallint | sim | — (check 1–5) |
| comment | text | não | null |

**PK:** `id`. **FK:** `transaction_id → marketplace_transactions.id` (`cascade`); `reviewer_id`/`reviewee_id → profiles.id` (`cascade`).
**Unique:** `(transaction_id, reviewer_id)`.
**RLS:** `select` — público; `insert` — apenas participante da transação, uma vez; sem `update`/`delete` (integridade de reputação).

---

### Módulo G — Trocas

#### `trade_proposals`
**Descrição:** Proposta de troca de itens entre dois colecionadores.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| proposer_id | uuid | sim | — |
| recipient_id | uuid | sim | — |
| status | trade_status (enum) | sim | `'pending'` |
| message | text | não | null |

**PK:** `id`. **FK:** `proposer_id`/`recipient_id → profiles.id` (`cascade`).
**Índices:** `idx_trade_proposals_proposer_id`, `idx_trade_proposals_recipient_id`.
**RLS:** `select`/`update` — proponente ou destinatário; `insert` — usuário autenticado (como proponente).

#### `trade_items`
**Descrição:** Itens oferecidos de cada lado de uma proposta de troca.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| trade_proposal_id | uuid | sim | — |
| collection_item_id | uuid | sim | — |
| offered_by | uuid | sim | — |

**PK:** `id`. **FK:** `trade_proposal_id → trade_proposals.id` (`cascade`); `collection_item_id → collection_items.id` (`restrict`); `offered_by → profiles.id` (`cascade`).
**Índices:** `idx_trade_items_trade_proposal_id`.
**RLS:** `select` — participantes da proposta; `insert`/`delete` — apenas quem ofereceu o item, enquanto proposta `pending`.

---

### Módulo H — Assinaturas

#### `subscription_plans`
**Descrição:** Catálogo de planos disponíveis (dado de referência, não por usuário).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| tier | subscription_tier (enum) | sim | — |
| name | text | sim | — |
| price_monthly | numeric(10,2) | sim | — |
| features | jsonb | sim | `'{}'` |
| is_active | boolean | sim | `true` |

**PK:** `id`. **Unique:** `tier`.
**RLS:** `select` — público; escrita — apenas admin.

#### `user_subscriptions`
**Descrição:** Assinatura vigente/histórica de um usuário.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| plan_id | uuid | sim | — |
| status | subscription_status (enum) | sim | `'active'` |
| started_at | timestamptz | sim | `now()` |
| current_period_end | timestamptz | sim | — |
| cancelled_at | timestamptz | não | null |

**PK:** `id`. **FK:** `user_id → profiles.id` (`cascade`); `plan_id → subscription_plans.id` (`restrict`).
**Índices:** `idx_user_subscriptions_user_id`, `idx_user_subscriptions_status`.
**RLS:** `select` — próprio usuário; `insert`/`update` — apenas `service_role` (via webhook/Edge Function de pagamento).

#### `payment_transactions`
**Descrição:** Registro de cobranças (integração futura com gateway de pagamento).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_subscription_id | uuid | não | null |
| user_id | uuid | sim | — |
| amount | numeric(10,2) | sim | — |
| currency | char(3) | sim | `'BRL'` |
| status | payment_status (enum) | sim | `'pending'` |
| provider_reference | text | não | null |

**PK:** `id`. **FK:** `user_subscription_id → user_subscriptions.id` (`set null`); `user_id → profiles.id` (`restrict`).
**Índices:** `idx_payment_transactions_user_id`.
**Unique:** `provider_reference`.
**RLS:** `select` — próprio usuário (dados não-sensíveis; dado de cartão nunca reside neste banco); `insert`/`update` — apenas `service_role`.

---

### Módulo I — IA

#### `ai_analysis_requests`
**Descrição:** Solicitação de análise por IA (ex.: reconhecimento de moeda por foto, estimativa de valor).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| requested_by | uuid | sim | — |
| collection_item_id | uuid | não | null |
| analysis_type | ai_analysis_type (enum) | sim | — |
| input_photo_path | text | não | null |
| status | ai_status (enum) | sim | `'queued'` |

**PK:** `id`. **FK:** `requested_by → profiles.id` (`cascade`); `collection_item_id → collection_items.id` (`set null`).
**Índices:** `idx_ai_analysis_requests_requested_by`, `idx_ai_analysis_requests_status`.
**RLS:** `select`/`insert` — próprio usuário; `update` (status/resultado) — apenas `service_role` (Edge Function de IA).

#### `ai_analysis_results`
**Descrição:** Resultado estruturado retornado pela IA para uma requisição.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| request_id | uuid | sim | — |
| suggested_catalog_item_id | uuid | não | null |
| confidence_score | numeric(5,4) | não | null |
| estimated_value_min | numeric(12,2) | não | null |
| estimated_value_max | numeric(12,2) | não | null |
| raw_output | jsonb | não | null |

**PK:** `id`. **FK:** `request_id → ai_analysis_requests.id` (`cascade`); `suggested_catalog_item_id → catalog_items.id` (`set null`).
**Índices:** `idx_ai_analysis_results_request_id`.
**RLS:** `select` — dono da requisição relacionada; `insert` — apenas `service_role`; sem `update`/`delete` (resultado é histórico imutável).

---

### Módulo J — Mensagens

#### `conversations`
**Descrição:** Thread de conversa (pode originar de marketplace, troca ou chat direto).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| context_type | conversation_context (enum) | sim | `'direct'` |
| context_id | uuid | não | null (referência polimórfica ao listing/trade de origem) |
| last_message_at | timestamptz | não | null |

**PK:** `id`. **Índices:** `idx_conversations_context`, `idx_conversations_last_message_at`.
**Relacionamentos:** 1:N com `conversation_participants`, `messages`.
**RLS:** `select`/`update` — apenas participantes (via `conversation_participants`).

#### `conversation_participants`
**Descrição:** Associação usuário ↔ conversa.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| conversation_id | uuid | sim | — |
| user_id | uuid | sim | — |
| last_read_at | timestamptz | não | null |

**PK:** composta (`conversation_id`, `user_id`). **FK:** `conversation_id → conversations.id` (`cascade`); `user_id → profiles.id` (`cascade`).
**Índices:** `idx_conversation_participants_user_id`.
**RLS:** `select` — próprio registro; `insert` — via Edge Function ao criar conversa; `update` (`last_read_at`) — próprio usuário.

#### `messages`
**Descrição:** Mensagem individual dentro de uma conversa.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| conversation_id | uuid | sim | — |
| sender_id | uuid | sim | — |
| content | text | não | null |
| attachment_path | text | não | null |
| message_type | message_type (enum) | sim | `'text'` |

**PK:** `id`. **FK:** `conversation_id → conversations.id` (`cascade`); `sender_id → profiles.id` (`cascade`).
**Índices:** `idx_messages_conversation_id_created_at` (composto, ordenação cronológica).
**RLS:** `select`/`insert` — apenas participantes da conversa; `update`/`delete` — proibido (editar mensagem quebra confiança; usar "mensagem apagada" via soft delete pelo próprio remetente apenas).
**Observação:** candidata a particionamento por `created_at` conforme 1.3.

---

### Módulo K — Notificações

#### `notifications`
**Descrição:** Notificação individual gerada para um usuário.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| type | notification_type (enum) | sim | — |
| title | text | sim | — |
| body | text | não | null |
| link | text | não | null |
| read_at | timestamptz | não | null |

**PK:** `id`. **FK:** `user_id → profiles.id` (`cascade`).
**Índices:** `idx_notifications_user_id_read_at`.
**RLS:** `select`/`update` (`read_at`) — próprio usuário; `insert` — apenas `service_role`.
**Observação:** candidata a particionamento por `created_at`.

#### `notification_preferences`
**Descrição:** Preferências de opt-in/opt-out por tipo de notificação e canal.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| notification_type | notification_type (enum) | sim | — |
| channel | notification_channel (enum) | sim | — |
| enabled | boolean | sim | `true` |

**PK:** composta (`user_id`, `notification_type`, `channel`). **FK:** `user_id → profiles.id` (`cascade`).
**RLS:** `select`/`update`/`insert` — próprio usuário.

---

### Módulo L — Relatórios

#### `content_reports`
**Descrição:** Denúncia de conteúdo (anúncio, mensagem, usuário) para moderação.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| reporter_id | uuid | sim | — |
| target_type | report_target_type (enum) | sim | — |
| target_id | uuid | sim | — |
| reason | report_reason (enum) | sim | — |
| details | text | não | null |
| status | report_status (enum) | sim | `'open'` |

**PK:** `id`. **FK:** `reporter_id → profiles.id` (`cascade`).
**Índices:** `idx_content_reports_status`, `idx_content_reports_target`.
**RLS:** `select` — próprio reporte ou moderador/admin; `insert` — usuário autenticado; `update` (status) — apenas moderador/admin.

#### `saved_reports`
**Descrição:** Relatórios/exportações salvas pelo próprio usuário (ex.: relatório de valor da coleção em PDF).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| report_type | text | sim | — |
| parameters | jsonb | não | `'{}'` |
| storage_path | text | não | null |

**PK:** `id`. **FK:** `user_id → profiles.id` (`cascade`).
**RLS:** `select`/`insert`/`delete` — próprio usuário.

---

### Módulo M — Administração

#### `admin_actions`
**Descrição:** Registro de toda ação administrativa/moderação sensível (complementa `audit_logs` com semântica de negócio específica).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| admin_id | uuid | sim | — |
| action_type | admin_action_type (enum) | sim | — |
| target_type | text | sim | — |
| target_id | uuid | sim | — |
| reason | text | não | null |

**PK:** `id`. **FK:** `admin_id → profiles.id` (`restrict`).
**Índices:** `idx_admin_actions_admin_id`, `idx_admin_actions_target`.
**RLS:** `select` — apenas admin; `insert` — apenas `service_role` (via Edge Function que já valida papel); sem `update`/`delete`.

#### `moderation_queue`
**Descrição:** Fila de itens pendentes de revisão humana (denúncias, contribuições de catálogo da comunidade).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| item_type | text | sim | — |
| item_id | uuid | sim | — |
| priority | smallint | sim | `0` |
| assigned_to | uuid | não | null |
| status | moderation_status (enum) | sim | `'pending'` |

**PK:** `id`. **FK:** `assigned_to → profiles.id` (`set null`).
**Índices:** `idx_moderation_queue_status_priority`.
**RLS:** `select`/`update` — apenas moderador/admin; `insert` — `service_role`.

---

### Módulo N — Logs & Auditoria

Detalhado integralmente na seção 6. Tabelas: `audit_logs`, `system_logs`, `error_logs`.

---

### Módulo O — Sistema

#### `system_config`
**Descrição:** Configuração dinâmica do sistema (chave/valor), consultada pela aplicação em runtime.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| key | text | sim | — |
| value | jsonb | sim | — |
| description | text | não | null |

**PK:** `id`. **Unique:** `key`.
**RLS:** `select` — público apenas para chaves marcadas `is_public` (coluna adicional); demais — apenas `service_role`; escrita — apenas admin.

#### `feature_flags`
**Descrição:** Flags de rollout progressivo de funcionalidades (alinhado à seção 28.4 do `PROJECT_RULES.md`).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| key | text | sim | — |
| is_enabled | boolean | sim | `false` |
| rollout_percentage | smallint | sim | `0` |
| target_roles | user_role[] | não | null |

**PK:** `id`. **Unique:** `key`.
**RLS:** `select` — leitura ampla necessária para avaliação no client (apenas metadados não-sensíveis); escrita — apenas admin.

#### `app_versions`
**Descrição:** Versões publicadas do app (suporte a force-update de PWA/mobile).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| platform | app_platform (enum) | sim | — |
| version | text | sim | — |
| is_mandatory | boolean | sim | `false` |
| release_notes | text | não | null |

**PK:** `id`. **Unique:** `(platform, version)`.
**RLS:** `select` — público; escrita — admin.

---

### Módulo P — Analytics

#### `user_events`
**Descrição:** Evento bruto de uso do produto (telemetria de UX, não confundir com `audit_logs` de segurança).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | não | null (permite evento anônimo) |
| event_name | text | sim | — |
| properties | jsonb | não | `'{}'` |
| session_id | uuid | não | null |

**PK:** composta (`id`, `created_at`) — **particionada por `created_at` (mensal)** desde o design. **FK:** `user_id → profiles.id` (`set null`).
**Índices:** `idx_user_events_event_name`, `idx_user_events_user_id`.
**RLS:** `insert` — `service_role`/client autenticado (evento próprio); `select` — apenas admin/analytics interno.

#### `aggregated_metrics`
**Descrição:** Métricas pré-agregadas (materializadas por job) para dashboards, evitando `count`/`group by` pesado em tabelas transacionais.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| metric_key | text | sim | — |
| period_start | date | sim | — |
| period_granularity | text | sim | `'day'` |
| value | numeric | sim | — |

**PK:** `id`. **Unique:** `(metric_key, period_start, period_granularity)`.
**RLS:** `select` — apenas admin; `insert`/`update` — apenas `service_role` (job agregador).

---

### Módulo Q — Gamificação

#### `user_points`
**Descrição:** Saldo de pontos de gamificação por usuário (estado atual, derivado de `point_transactions`).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| total_points | int | sim | `0` |
| current_level | int | sim | `1` |

**PK:** `user_id` (mesmo valor de `profiles.id`). **FK:** `user_id → profiles.id` (`cascade`).
**RLS:** `select` — público (ranking); `update` — apenas `service_role` (via trigger/job a partir de `point_transactions`).

#### `point_transactions`
**Descrição:** Histórico append-only de cada ganho/perda de ponto (fonte de verdade de `user_points`).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| points | int | sim | — |
| reason | text | sim | — |
| reference_type | text | não | null |
| reference_id | uuid | não | null |

**PK:** `id`. **FK:** `user_id → profiles.id` (`cascade`).
**Índices:** `idx_point_transactions_user_id`.
**RLS:** `select` — próprio usuário; `insert` — apenas `service_role`; sem `update`/`delete`.

---

### Módulo R — Conquistas

#### `achievements`
**Descrição:** Catálogo de conquistas disponíveis (dado de referência).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| code | text | sim | — |
| name | text | sim | — |
| description | text | não | null |
| icon_path | text | não | null |
| points_reward | int | sim | `0` |

**PK:** `id`. **Unique:** `code`.
**RLS:** `select` — público; escrita — admin.

#### `user_achievements`
**Descrição:** Conquista desbloqueada por um usuário.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| achievement_id | uuid | sim | — |
| unlocked_at | timestamptz | sim | `now()` |

**PK:** composta (`user_id`, `achievement_id`). **FK:** `user_id → profiles.id` (`cascade`); `achievement_id → achievements.id` (`cascade`).
**RLS:** `select` — público (exibição de perfil); `insert` — apenas `service_role`; sem `update`/`delete`.

---

### Módulo S — Wishlist

#### `wishlist_items`
**Descrição:** Item que o usuário deseja adquirir, podendo referenciar o catálogo mestre ou ser livre.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| user_id | uuid | sim | — |
| catalog_item_id | uuid | não | null |
| custom_description | text | não | null |
| max_price | numeric(12,2) | não | null |
| priority | wishlist_priority (enum) | sim | `'medium'` |
| notify_on_listing | boolean | sim | `true` |

**PK:** `id`. **FK:** `user_id → profiles.id` (`cascade`); `catalog_item_id → catalog_items.id` (`set null`).
**Índices:** `idx_wishlist_items_user_id`, `idx_wishlist_items_catalog_item_id` (usado para matching automático com novos `marketplace_listings`).
**RLS:** `select`/`insert`/`update`/`delete` — apenas próprio usuário.

---

### Módulo T — Eventos

#### `events`
**Descrição:** Feiras, exposições e encontros de colecionadores (presenciais ou online).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| organizer_id | uuid | não | null |
| title | text | sim | — |
| description | text | não | null |
| location | text | não | null |
| starts_at | timestamptz | sim | — |
| ends_at | timestamptz | sim | — |
| is_online | boolean | sim | `false` |

**PK:** `id`. **FK:** `organizer_id → profiles.id` (`set null`).
**Índices:** `idx_events_starts_at`.
**RLS:** `select` — público; `insert`/`update`/`delete` — organizador ou admin.

#### `event_participants`
**Descrição:** Confirmação de presença/interesse de um usuário em um evento.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| event_id | uuid | sim | — |
| user_id | uuid | sim | — |
| status | event_participation_status (enum) | sim | `'interested'` |

**PK:** composta (`event_id`, `user_id`). **FK:** `event_id → events.id` (`cascade`); `user_id → profiles.id` (`cascade`).
**RLS:** `select` — público; `insert`/`update`/`delete` — próprio usuário.

---

## 4. Storage — Estrutura Completa

Buckets segregados por sensibilidade e finalidade (alinhado à seção 11.5 e 13.5 do `PROJECT_RULES.md`). Toda tabela referencia **path relativo**, nunca URL absoluta/assinada persistida.

| Bucket | Público? | Conteúdo | Estrutura de path |
|---|---|---|---|
| `avatars` | Sim (leitura) | Foto de perfil do usuário | `avatars/{user_id}/{filename}` |
| `coins` | Condicional (conforme `item_photos`/visibilidade do item) | Fotos de itens de coleção, subdividido por ângulo | `coins/{collection_item_id}/front/{filename}`, `.../back/`, `.../edge/` |
| `certificates` | Privado | Laudos/certificados de autenticidade | `certificates/{user_id}/{collection_item_id}/{filename}` |
| `documents` | Privado (restrito) | Documentos de verificação de vendedor (KYC leve) | `documents/{user_id}/{filename}` |
| `chat` | Privado | Anexos de mensagens | `chat/{conversation_id}/{filename}` |
| `marketplace` | Público (para anúncios ativos) | Fotos de capa/anúncio | `marketplace/{listing_id}/{filename}` |
| `catalog` | Público | Imagens de referência do catálogo mestre (curadoria admin) | `catalog/{catalog_item_id}/{filename}` |
| `temp` | Privado, TTL curto | Upload em progresso antes de vinculação à entidade final | `temp/{user_id}/{upload_session_id}/{filename}` |
| `imports` | Privado | Arquivos de importação em lote (CSV/planilha do usuário) | `imports/{user_id}/{job_id}/{filename}` |
| `exports` | Privado, TTL curto | Relatórios/exportações geradas (`saved_reports`) | `exports/{user_id}/{report_id}/{filename}` |

**Regras transversais de Storage:**
- Bucket `temp` possui política de expiração automática (job periódico remove arquivos não vinculados após 24h) — nunca fonte de verdade permanente.
- Todo upload passa por pipeline de validação/reprocessamento (seção 13.5 do `PROJECT_RULES.md`) antes de ficar acessível publicamente — nunca serve o arquivo bruto do usuário sem sanitização.
- Policies de Storage espelham a policy RLS da tabela de metadados correspondente (ex.: acesso a `coins/{collection_item_id}/*` segue a mesma regra de visibilidade de `collection_items`).
- Buckets `documents` e `certificates` nunca são públicos, mesmo que o item/usuário seja público — acesso exclusivamente via URL assinada de curta duração, gerada sob demanda.

---

## 5. Enumerações

| Enum | Valores |
|---|---|
| `user_role` | `visitor`, `user`, `verified_seller`, `moderator`, `admin`, `system`, `ai` |
| `subscription_tier` | `free`, `premium`, `pro` |
| `subscription_status` | `active`, `past_due`, `cancelled`, `expired`, `trialing` |
| `payment_status` | `pending`, `succeeded`, `failed`, `refunded` |
| `device_type` | `web`, `ios`, `android`, `desktop` |
| `catalog_item_type` | `coin`, `banknote`, `medal`, `token` |
| `coin_material` | `gold`, `silver`, `copper`, `bronze`, `nickel`, `aluminum`, `bimetallic`, `other` |
| `grading_scale` | `sheldon_70`, `mercosul_10`, `custom` |
| `grading_source` | `self_reported`, `community`, `professional`, `ai` |
| `item_visibility` | `private`, `collection_only`, `public` |
| `photo_angle` | `front`, `back`, `edge`, `certificate`, `other` |
| `listing_status` | `draft`, `active`, `paused`, `sold`, `cancelled` |
| `offer_status` | `pending`, `accepted`, `rejected`, `cancelled`, `expired` |
| `transaction_status` | `pending`, `paid`, `shipped`, `completed`, `disputed`, `refunded` |
| `trade_status` | `pending`, `accepted`, `rejected`, `cancelled`, `completed` |
| `ai_analysis_type` | `recognition`, `condition_estimate`, `value_estimate`, `authenticity_check` |
| `ai_status` | `queued`, `processing`, `completed`, `failed` |
| `conversation_context` | `direct`, `marketplace_listing`, `trade_proposal`, `support` |
| `message_type` | `text`, `image`, `system` |
| `notification_type` | `new_offer`, `offer_accepted`, `new_message`, `trade_proposal`, `wishlist_match`, `achievement_unlocked`, `system_announcement`, `moderation_update` |
| `notification_channel` | `in_app`, `push`, `email` |
| `report_target_type` | `listing`, `message`, `user`, `catalog_item`, `event` |
| `report_reason` | `fraud`, `counterfeit`, `spam`, `harassment`, `inappropriate_content`, `other` |
| `report_status` | `open`, `in_review`, `resolved`, `dismissed` |
| `admin_action_type` | `role_change`, `content_removal`, `account_suspension`, `account_reinstatement`, `catalog_edit`, `report_resolution` |
| `moderation_status` | `pending`, `in_review`, `approved`, `rejected` |
| `app_platform` | `web`, `ios`, `android` |
| `wishlist_priority` | `low`, `medium`, `high` |
| `event_participation_status` | `interested`, `confirmed`, `attended`, `cancelled` |
| `audit_action` | `insert`, `update`, `delete`, `login`, `logout`, `permission_change`, `export`, `access_denied` |

---

## 6. Auditoria

### 6.1. `audit_logs`
**Descrição:** Tabela central e imutável de auditoria, cobrindo toda ação sensível do sistema (alinhada à seção 18 do `PROJECT_RULES.md`).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| actor_id | uuid | não | null (nulo = ação do sistema) |
| actor_role | user_role (enum) | sim | — |
| action | audit_action (enum) | sim | — |
| entity_type | text | sim | — |
| entity_id | uuid | não | null |
| before_data | jsonb | não | null |
| after_data | jsonb | não | null |
| ip_address | inet | não | null |
| user_agent | text | não | null |
| device_id | uuid | não | null |
| session_id | uuid | não | null |
| request_id | text | não | null (correlação com tracing — seção 38 do `PROJECT_RULES.md`) |

**PK:** composta (`id`, `created_at`) — **particionada por `created_at` (mensal)**.
**FK:** `actor_id → profiles.id` (`set null` — preserva o log mesmo se o usuário for removido); `device_id → user_devices.id` (`set null`).
**Índices:** `idx_audit_logs_actor_id`, `idx_audit_logs_entity` (`entity_type`, `entity_id`), `idx_audit_logs_action`, `idx_audit_logs_created_at`.
**RLS:** `insert` — apenas `service_role` (nunca o client diretamente); `select` — apenas `admin`; **sem `update`/`delete` para nenhum papel** (imutabilidade garantida por RLS, não apenas por convenção).

**Campos "quem/quando/onde" mapeados:**
- **Quem:** `actor_id` + `actor_role`.
- **Quando:** `created_at` (herdado do padrão global).
- **IP:** `ip_address`.
- **Dispositivo:** `device_id` → join com `user_devices` para `device_type`/`device_name`.
- **Sessão:** `session_id` → join com `user_sessions`.
- **Histórico:** `before_data`/`after_data` em `jsonb`, permitindo diff completo do estado da entidade.

### 6.2. `system_logs`
**Descrição:** Log técnico de eventos de sistema/aplicação (não confundir com auditoria de negócio) — espelha o logging estruturado da seção 17 do `PROJECT_RULES.md`, mas persistido para consulta/retention quando necessário além do provedor de log externo.

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| level | text | sim | — (`debug`/`info`/`warn`/`error`/`fatal`) |
| source | text | sim | — (nome do serviço/função) |
| message | text | sim | — |
| context | jsonb | não | `'{}'` |
| request_id | text | não | null |

**PK:** composta (`id`, `created_at`) — particionada mensalmente, com política de retenção curta (ex.: 30 dias) e purga automática.
**RLS:** `insert` — apenas `service_role`; `select` — apenas admin/sistema interno.

### 6.3. `error_logs`
**Descrição:** Log dedicado de erros de aplicação não tratados (complementar ao Sentry — seção 37 do `PROJECT_RULES.md`; útil para correlação direta com dados de negócio no próprio banco).

| Campo | Tipo | Obrigatório | Default |
|---|---|---|---|
| error_type | text | sim | — |
| message | text | sim | — |
| stack_trace | text | não | null |
| user_id | uuid | não | null |
| request_id | text | não | null |
| context | jsonb | não | `'{}'` |

**PK:** composta (`id`, `created_at`) — particionada mensalmente.
**FK:** `user_id → profiles.id` (`set null`).
**RLS:** `insert` — apenas `service_role`; `select` — apenas admin.

### 6.4. Escrita resiliente
Toda escrita em `audit_logs`/`system_logs`/`error_logs` ocorre de forma **assíncrona em relação à operação principal** (fila leve/`pg_notify` + worker, ou escrita direta não-bloqueante dentro da mesma Edge Function com tratamento de falha isolado) — falha ao gravar log gera alerta de monitoramento, nunca erro 500 para o usuário (conforme 18.4 do `PROJECT_RULES.md`).

---

## 7. Permissões

Modelo RBAC com hierarquia de papéis, aplicada em três camadas redundantes (UI, Application, RLS — seção 16.2 do `PROJECT_RULES.md`):

| Papel | Escopo de dados | Capacidades principais |
|---|---|---|
| **Visitante** (não autenticado) | Somente leitura pública | Ver catálogo mestre, anúncios ativos, perfis/coleções públicas, eventos |
| **Usuário** | Próprios dados + público | Tudo do Visitante + CRUD da própria coleção/wishlist/mensagens/ofertas/trocas |
| **Premium** (`plan_tier`) | Igual a Usuário + limites ampliados | Mesmas policies de RLS do Usuário; diferenciação de *limite de uso* (quantidade de itens, análises de IA) é validada na Application layer, não na RLS — RLS não modela cota, apenas propriedade do dado |
| **Vendedor Verificado** | Igual a Usuário + habilitação de venda plena | Publicar `marketplace_listings` sem restrição de moderação prévia (não-verificado pode ter publicação sujeita a `moderation_queue`, definido na Application layer) |
| **Moderador** | Leitura ampliada de conteúdo reportável | `select`/`update` em `content_reports`, `moderation_queue`; sem acesso a dados financeiros (`payment_transactions`) nem a `audit_logs` completo |
| **Administrador** | Acesso administrativo completo | Todas as capacidades de Moderador + gestão de `user_roles`, `system_config`, `feature_flags`, leitura de `audit_logs`/`error_logs` |
| **Sistema** (`service_role`) | Bypass de RLS (uso interno) | Exclusivo de Edge Functions/jobs de confiança — nunca exposto ao client; toda ação relevante executada como `system` é auditada com `actor_role = 'system'` |
| **IA** (papel lógico, executa via `service_role`) | Escrita restrita a tabelas de IA/grading assistido | `insert` em `ai_analysis_results`, `grading_records` (quando `graded_by = 'ai'`); nunca acesso a dados financeiros ou de outros módulos |

**Regra geral:** nenhuma policy de RLS concede acesso amplo "por papel" sem também restringir por propriedade do dado quando aplicável (ex.: Moderador não lê `payment_transactions` de ninguém — esse dado é visível apenas ao próprio usuário e ao `service_role`).

---

## 8. Estratégia de Backup

Detalhamento operacional (o princípio já está fixado na seção 19 do `PROJECT_RULES.md`), aplicado ao schema deste documento:

8.1. **PITR (Point-in-Time Recovery)** habilitado em produção com granularidade que atenda RPO ≤ 15 min — cobre 100% das tabelas transacionais deste documento, incluindo as particionadas (`audit_logs`, `messages`, `notifications`, `user_events`).

8.2. Tabelas com dado financeiro (`payment_transactions`, `marketplace_transactions`) e de auditoria (`audit_logs`) são tratadas como **prioridade máxima de integridade** — qualquer procedimento de restauração parcial testa explicitamente a consistência dessas tabelas com suas FKs relacionadas antes de ser considerado bem-sucedido.

8.3. Buckets de Storage possuem estratégia de backup própria do provedor; `certificates` e `documents` (dados sensíveis) são incluídos explicitamente na rotina de verificação de backup, não apenas as tabelas do Postgres.

8.4. Restauração de teste trimestral (seção 19.2 do `PROJECT_RULES.md`) inclui cenário específico de "restaurar e validar RLS" — garantir que policies restauradas continuam ativas e corretas após um restore, não apenas que os dados voltaram.

---

## 9. Estratégia de Performance

9.1. **Paginação obrigatória** (cursor-based preferencialmente a offset, para estabilidade em tabelas de alto volume) em toda listagem: `collection_items`, `marketplace_listings`, `messages`, `notifications`, `audit_logs`.

9.2. Queries de feed público (`marketplace_listings` ativos, `catalog_items` em busca) usam os índices compostos definidos na seção 3, evitando `seq scan` em tabelas de milhões de linhas.

9.3. Contadores de alta frequência de escrita (`marketplace_listings.views_count`) são **desnormalizados e atualizados de forma assíncrona/batelada** (nunca `UPDATE` síncrono a cada visualização), evitando contenção de linha ("hot row") — alinhado à seção 40.6 do `PROJECT_RULES.md`.

9.4. Busca textual do catálogo mestre usa índice `GIN` sobre `tsvector` (nunca `LIKE '%termo%'` sem índice em tabela de referência que tende a crescer para centenas de milhares de linhas).

9.5. Tabelas particionadas por tempo (`audit_logs`, `system_logs`, `error_logs`, `user_events`, `messages`, `notifications`) mantêm partições antigas com possibilidade de **arquivamento/compressão** ou movimentação para storage mais barato, sem impactar a partição "quente" (mês corrente) usada nas queries do dia a dia.

9.6. `EXPLAIN ANALYZE` obrigatório na revisão de qualquer query nova que toque tabela de alto volume antes de ir a produção — critério de aceite técnico incorporado ao processo de PR (seção 43.9 do `PROJECT_RULES.md`).

---

## 10. Estratégia para Futuras Integrações

10.1. **APIs de terceiros (cotação de metais, câmbio):** tabela de referência dedicada (a criar quando implementado) para cache local de cotações, atualizada por job periódico via Edge Function — nunca a aplicação consulta a API externa em tempo real no caminho crítico de renderização.

10.2. **Marketplaces/leilões externos:** modelo preparado para um futuro módulo de "listagem espelhada" — `marketplace_listings` já possui `currency`/estrutura desacoplada o suficiente para, no futuro, receber uma tabela de mapeamento `external_marketplace_links` sem alterar o modelo atual.

10.3. **Catálogos internacionais de referência (ex.: bases numismáticas externas):** `catalog_items.attributes` (`jsonb`) e `catalog_items` como entidade desacoplada de qualquer fonte específica permitem importação/reconciliação futura via campo de referência externa (`external_source`, `external_id` — extensível sem migration destrutiva).

10.4. **IA (evolução):** módulo já isolado (`ai_analysis_requests`/`ai_analysis_results`) permite trocar o provedor de IA por trás da Edge Function sem qualquer impacto no restante do schema — o contrato de dados é o mesmo independentemente do modelo/provedor usado.

10.5. **Aplicativos móveis nativos (fora do PWA):** como toda regra de autorização vive em RLS + Application layer (Edge Functions/Route Handlers) e não no client, um app nativo futuro consome exatamente as mesmas garantias de segurança sem duplicar lógica — `user_devices.device_type` já contempla `ios`/`android` nativos, não apenas PWA.

10.6. **Extensibilidade geral:** todo módulo novo futuro deve seguir o mesmo padrão desta arquitetura — tabela âncora referenciando `profiles.id`, RLS desde a primeira migration, e entrada correspondente neste documento antes de ir a produção (processo de RFC — seção 33.3 do `PROJECT_RULES.md`).

---

*Fim do documento. Toda alteração de schema aqui descrita é implementada exclusivamente via migrations versionadas (seção 32.5 do `PROJECT_RULES.md`) e este documento é atualizado em conjunto, no mesmo PR, para nunca divergir da implementação real.*
