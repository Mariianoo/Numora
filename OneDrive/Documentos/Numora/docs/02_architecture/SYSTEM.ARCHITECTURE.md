# SYSTEM_ARCHITECTURE.md — Numisphere

> **Papel deste documento:** explicação completa de como o sistema funciona internamente — o "motor" por trás do que `PRODUCT_BIBLE.md`/`UX_BIBLE.md` descrevem como experiência e do que `DATABASE.md`/`API_SPEC.yaml` descrevem como contrato de dados/API. Subordinado a `PROJECT_RULES.md` (fonte única de verdade técnica) — este documento detalha comportamento de runtime e fluxo, sem repetir nem contradizer regras já fixadas lá.
> **Não é:** guia de implementação, código, SQL ou componentes — é o mapa mental de como as peças já especificadas se conectam e se comportam em produção.
> **Status:** Lote 2 de N. Ver nota de progresso ao final.

---

## Sumário deste lote

1. Arquitetura Geral
2. Arquitetura em Camadas
3. Fluxo de Dados
4. Fluxo de Autenticação
5. Fluxo de Upload
6. Fluxo de Scanner IA
7. Fluxo Marketplace
8. Fluxo Trocas
9. Fluxo Assinaturas
10. Fluxo de Notificações
11. Fluxo de Chat
12. Fluxo de Analytics
13. Eventos do Sistema
14. Event Bus
15. Filas
16. Cache

---

# 1. Arquitetura Geral

O Numisphere é um **SaaS PWA serverless orientado a Edge**, construído sobre Next.js (App Router) como camada de apresentação/orquestração e Supabase como plataforma de dados/identidade (`PROJECT_RULES.md` §4). Não existe um "servidor de aplicação" monolítico de longa duração — a lógica de negócio roda em funções sem estado (Route Handlers, Server Actions, Edge Functions), invocadas sob demanda e escaladas automaticamente pela infraestrutura (Vercel + Supabase).

**Componentes de mais alto nível:**
| Componente | Papel |
|---|---|
| PWA Client | Interface do usuário, cache local (IndexedDB), Service Worker |
| Next.js (Edge/App Router) | Renderização, roteamento, orquestração de casos de uso |
| PostgreSQL (Supabase) | Fonte única de verdade dos dados, com RLS como camada de autorização |
| Supabase Auth | Identidade, sessão, MFA |
| Supabase Storage | Arquivos (fotos, certificados, exports) |
| Supabase Edge Functions | Lógica sensível/pesada fora do caminho síncrono do client (IA, pagamento, moderação) |
| Supabase Realtime | Canais de atualização ao vivo (chat, notificações, ofertas) |
| Redis (cache/filas) | Cache de leitura pesada, rate limiting, filas leves |
| CDN (Vercel Edge Network + CDN de Storage) | Distribuição de assets estáticos e mídia pública |

**Por que serverless/Edge:** o requisito de suportar milhões de usuários (`PROJECT_RULES.md` §1.2, §40) exige escala horizontal automática sem gerência manual de servidores; o custo dessa escolha é que **toda função é stateless por definição** — qualquer estado que precise sobreviver entre chamadas vive no banco, no Storage, no Redis ou no client, nunca em memória de processo.

---

# 2. Arquitetura em Camadas

O sistema segue Clean Architecture adaptada (`PROJECT_RULES.md` §4.2), com quatro camadas lógicas que existem **independentemente de onde o código roda fisicamente** (client, Route Handler, Edge Function):

```
Presentation → Application → Domain → Infrastructure
```

- **Presentation:** páginas, componentes, o que o usuário vê e toca. Nunca acessa banco diretamente.
- **Application:** orquestra casos de uso (ex.: "adicionar item à coleção"), aplica autorização de negócio, chama repositórios por interface.
- **Domain:** regras puras (ex.: "um item precisa de nome ou vínculo ao catálogo"), sem dependência de Supabase/React/rede.
- **Infrastructure:** implementações concretas (client Supabase, chamadas a Storage, chamadas a provedores externos).

**Regra de dependência (reforçada aqui em nível de sistema):** uma camada só conhece a camada imediatamente abaixo por meio de interface — o Domain nunca sabe que o banco é Postgres, o que permite, por exemplo, trocar o provedor de IA (Infrastructure) sem tocar em regra de negócio (Domain).

**Onde cada camada roda fisicamente:**
| Camada | Ambiente de execução típico |
|---|---|
| Presentation | Client (PWA) + Server Components (SSR) |
| Application | Server Actions / Route Handlers / Edge Functions |
| Domain | Compartilhado — mesmo código pode rodar client-side (validação otimista) e server-side (validação autoritativa) |
| Infrastructure | Server Actions / Route Handlers / Edge Functions (nunca no client, exceto chamadas autenticadas ao PostgREST via client `anon` respeitando RLS) |

---

# 3. Fluxo de Dados

## 3.1. Padrão geral de leitura

```
Client → TanStack Query (cache local) → [hit? retorna] → [miss?] →
PostgREST (via Supabase client, respeitando RLS) → Postgres → resposta →
cache local atualizado → UI renderizada
```

Leituras de catálogo mestre (baixa frequência de mudança) passam antes por Redis (seção 16); leituras de dados privados do usuário (coleção, mensagens) vão direto ao Postgres via RLS, sem camada de cache compartilhado entre usuários.

## 3.2. Padrão geral de escrita

```
Client → validação otimista (Domain compartilhado) → Server Action/Route Handler →
validação autoritativa (Application) → autorização (Application + RLS) →
Infrastructure (Postgres/Storage) → trigger de auditoria (fn_audit_trigger) →
evento de domínio emitido (seção 13) → resposta ao client → cache local invalidado
```

## 3.3. Direção de verdade

O **Postgres é sempre a fonte de verdade**. Todo outro estado (cache Redis, cache local TanStack Query, IndexedDB offline, estado de UI) é uma **cópia derivada e temporária**, sujeita a invalidação. Nenhum fluxo do sistema é desenhado para tratar cache como autoritativo — isso é o que garante que o sistema permanece correto mesmo quando uma camada de cache falha (`PROJECT_RULES.md` §20.5).

---

# 4. Fluxo de Autenticação

## 4.1. Cadastro/Login

```
Client → POST /auth/register|login → Supabase Auth valida credenciais →
emite access token (JWT, 1h) + refresh token (rotativo, 30 dias) →
trigger de banco cria/atualiza `profiles` a partir de `auth.users` →
tokens retornados ao client → client armazena em cookie httpOnly
```

## 4.2. Requisição autenticada

```
Client anexa `Authorization: Bearer <access_token>` →
Route Handler/Server Action valida o JWT (assinatura + expiração) →
contexto de usuário (auth.uid(), claims) disponível para RLS e Application layer →
toda query ao Postgres carrega esse contexto automaticamente via o client autenticado do Supabase
```

## 4.3. Renovação de sessão

```
Access token expira → client detecta 401 →
dispara POST /auth/refresh com o refresh token →
Supabase Auth valida e rotaciona (invalida o antigo, emite um novo par) →
requisição original é reexecutada de forma transparente ao usuário
```

## 4.4. MFA

```
Login com credenciais válidas + MFA ativo →
Supabase Auth retorna estado "mfa_required" em vez de tokens finais →
client solicita código TOTP → POST /auth/mfa/verify → tokens finais emitidos
```

## 4.5. Autorização em camadas (reforço em nível de sistema)

Toda requisição autenticada passa por **três checagens independentes**, nunca apenas uma (`PROJECT_RULES.md` §16.2): (1) a UI já esconde ações não permitidas, (2) a Application layer valida papel/propriedade antes de executar o caso de uso, (3) RLS no Postgres impede o acesso mesmo que as duas primeiras falhem. Isso significa que, arquiteturalmente, **um bug de front-end nunca é suficiente para vazar dado** — a camada 3 é a rede de segurança final.

---

# 5. Fluxo de Upload

Modelo de **duas etapas**, para nunca sobrecarregar a camada de aplicação com bytes de arquivo (alinhado à API_SPEC.yaml, seção Uploads):

```
1. Client → POST /uploads/request-url (bucket, content_type, size_bytes) →
   Route Handler valida tipo/tamanho/quota do plano →
   Supabase Storage emite signed upload URL de curta duração + upload_id →
   resposta ao client

2. Client → PUT direto para a signed URL (bytes vão direto ao Storage,
   sem passar pela camada de aplicação)

3. Client → POST /uploads/{upload_id}/complete →
   Edge Function dispara pipeline de reprocessamento/sanitização de imagem
   (`PROJECT_RULES.md` §13.5) → storage_path final é vinculado à entidade
   de domínio (ex.: item_photos) → evento `item_photo_added` emitido
```

**Por que duas etapas:** permite que o upload em si escale independentemente da camada de aplicação (o arquivo nunca "passa" pelo Route Handler) e permite validação de quota/tipo **antes** de qualquer byte trafegar.

**Arquivos temporários não confirmados** (etapa 3 nunca executada) expiram automaticamente do bucket `temp` via job periódico (seção 21).

---

# 6. Fluxo de Scanner IA

```
Client captura foto (câmera/galeria) → validação client-side de qualidade
(não bloqueante) → Upload (fluxo da seção 5, bucket `temp` inicialmente) →
POST /ai/analysis-requests (analysis_type=recognition) →
Route Handler cria registro em `ai_analysis_requests` (status=queued) →
resposta imediata ao client com o ID da requisição (processamento é assíncrono)

→ Edge Function de IA é disparada (via fila/evento — seção 14/15) →
  chama o provedor de IA/visão computacional externo →
  grava resultado em `ai_analysis_results` →
  atualiza `ai_analysis_requests.status=completed` →
  emite evento `ai_analysis_completed` →
  dispara notificação in-app/push ao usuário (seção 10)

→ Client (via Realtime ou polling, seção 22) recebe a atualização de status →
  exibe sugestão(ões) com nível de confiança →
  usuário confirma → segue o fluxo padrão de criação de `collection_items`
```

**Ponto crítico de arquitetura:** a análise de IA é **sempre assíncrona do ponto de vista do sistema**, mesmo quando percebida como "quase instantânea" pelo usuário — isso isola a latência/instabilidade de um provedor de IA externo do caminho crítico de outras operações, e é o que permite o fluxo funcionar com captura offline (a requisição só é criada quando a conexão retorna).

---

# 7. Fluxo Marketplace

## 7.1. Criação e publicação de anúncio

```
Client → POST /marketplace/listings (collection_item_id, price) →
Application valida propriedade do item (RN-01) e ausência de outro anúncio
ativo para o mesmo item → registro criado em `marketplace_listings` (status=draft) →
usuário revisa → PATCH status=active → anúncio visível publicamente
(RLS: select público apenas quando status=active)
```

## 7.2. Oferta e negociação

```
Comprador → POST /marketplace/offers (listing_id, offer_price) →
notificação ao vendedor (seção 10) →
vendedor aceita/recusa → PATCH offer.status →
se aceita: Edge Function transacional inicia o fluxo de conclusão
```

## 7.3. Conclusão de transação (operação atômica e auditada)

```
Edge Function (service_role, nunca o client diretamente) →
transação de banco: cria `marketplace_transactions` (snapshot imutável do item),
marca `marketplace_listings.status=sold`,
registra em `audit_logs` (ação sensível — RN-04) →
dispara `payment_transactions` quando aplicável (seção Assinaturas/Pagamentos
compartilha a mesma infraestrutura de pagamento) →
notifica comprador e vendedor →
libera avaliação mútua (`marketplace_reviews`)
```

**Por que a conclusão é uma Edge Function e não um Route Handler comum:** a transição de propriedade + pagamento + auditoria precisa ser **atômica** (tudo ou nada) e rodar com privilégio de `service_role` para tocar múltiplas tabelas de forma consistente, algo que a Application layer comum, restrita por RLS do usuário, não deve fazer diretamente (`PROJECT_RULES.md` §11.1).

---

# 8. Fluxo Trocas

```
Proponente → POST /trades (recipient_id, itens oferecidos) →
registro em `trade_proposals` (status=pending) + `trade_items` por lado →
notificação ao destinatário →

destinatário revisa → pode contrapropor (nova entrada em `trade_items`
antes de aceitar) ou aceitar/recusar diretamente →

aceite de ambos os lados → Edge Function transacional (mesmo padrão da
seção 7.3): transferência de `owner_id` dos itens envolvidos em uma única
transação atômica, nunca uma edição direta de propriedade pelo client
(RN-01, RN-08) → `trade_proposals.status=completed` → auditoria →
notificações finais a ambas as partes
```

**Garantia de integridade (RN-08):** nenhuma troca é considerada concluída sem confirmação explícita das duas partes, e a transferência de `owner_id` só ocorre dentro dessa transação atômica final — nunca como efeito colateral de uma edição comum de item.

---

# 9. Fluxo Assinaturas

```
Client → seleciona plano → POST /subscriptions →
Route Handler cria intenção de assinatura → redireciona/integra com
gateway de pagamento externo (fora do escopo deste documento — integração
via Edge Function dedicada, seção 17) →

Webhook do gateway → Edge Function recebe evento assinado →
valida assinatura do webhook → atualiza `user_subscriptions` e
`payment_transactions` → atualiza `profiles.plan_tier` (via service_role) →
emite evento `subscription_activated`/`subscription_cancelled` →
invalida cache de cota (seção 16) → notifica o usuário
```

**Ponto crítico:** a mudança de `plan_tier` **nunca é iniciada pelo client diretamente** — é sempre resultado de um webhook validado processado por Edge Function com `service_role`, o que impede que um client comprometido se autopromova a plano pago sem pagamento real.

**Renovação e cota:** a cota de IA (`ai_analysis_requests` por período — `PROJECT_RULES.md` RN-06) é recalculada a cada início de período de cobrança, disparado pelo mesmo webhook de renovação.

---

# 10. Fluxo de Notificações

```
Evento de domínio ocorre em qualquer módulo (ex.: `marketplace_offer_received`,
`wishlist_match_found`, `ai_analysis_completed`) →
publicado no Event Bus (seção 14) →

Edge Function "Notification Dispatcher" consome o evento →
consulta `notification_preferences` do usuário-alvo (opt-in por tipo/canal) →
para cada canal habilitado:
  - in_app  → insert em `notifications` (lido via Realtime, seção 22)
  - push    → Web Push/FCM/APNs usando `user_devices.push_token`
  - email   → provedor de e-mail transacional

→ usuário interage (abre notificação) → `notifications.read_at` atualizado
```

**Desacoplamento:** nenhum módulo de negócio (Marketplace, Trocas, IA...) chama diretamente um provedor de push/e-mail — todos apenas emitem eventos de domínio; o Notification Dispatcher é o único ponto que conhece os canais de entrega, o que permite adicionar um canal novo (ex.: SMS) sem tocar em nenhum outro módulo.

---

# 11. Fluxo de Chat

```
Cliente A → POST /messages (conversation_id, content) →
Route Handler valida participação na conversa (RLS conversation_participants) →
insert em `messages` →

Supabase Realtime propaga o insert via canal da conversa (seção 22) →
Cliente B (se online, inscrito no canal) recebe a mensagem instantaneamente →
se offline → evento de domínio `message_sent` também aciona o fluxo de
Notificações (seção 10) para entrega assíncrona (push/e-mail)

→ Cliente B abre a conversa → PATCH conversation_participants.last_read_at →
  contador de não lidas do Cliente A é atualizado (via Realtime ou refetch)
```

**Model de entrega híbrido:** Realtime cobre o caso "ambos online" com latência mínima; o pipeline de Notificações (seção 10) cobre o caso "destinatário offline" — os dois nunca competem, são complementares por design.

---

# 12. Fluxo de Analytics

```
Ação do usuário no client (view de tela, clique relevante) OU evento de
domínio server-side (seção 13) →
evento é enviado (client) ou emitido diretamente (server) para o pipeline
de analytics →

insert em `user_events` (schema `analytics`, particionado por mês) →

job periódico (seção 21) agrega `user_events` em `aggregated_metrics`
(pré-cálculo para dashboards — nunca se calcula `count`/`group by` pesado
em tempo real sobre a tabela bruta) →

dashboards internos (Admin/Analytics, tag Analytics da API) consultam
exclusivamente `aggregated_metrics` para leitura rápida
```

**Separação de responsabilidade:** eventos de **negócio** (usados por Notificações, Gamificação, auditoria) e eventos de **telemetria de uso** (usados por Analytics) compartilham a infraestrutura de Event Bus (seção 14), mas têm destinos de persistência diferentes (`audit_logs`/domínio vs. `user_events`) — um evento de domínio pode, quando relevante, alimentar os dois caminhos simultaneamente (ex.: `collection_item_created` é ao mesmo tempo um evento de auditoria leve e um evento de analytics).

---

# 13. Eventos do Sistema

## 13.1. Papel dos eventos

Eventos são o mecanismo de **desacoplamento entre módulos** (`PROJECT_RULES.md` §4.2 — módulos "quase independentes"). Um módulo nunca chama diretamente uma função de outro módulo para reagir a algo que aconteceu nele — ele **emite um evento** e qualquer módulo interessado **assina** esse evento.

## 13.2. Anatomia de um evento

Todo evento de domínio carrega, no mínimo: `event_name` (nome semântico, ex.: `collection_item_created`), `occurred_at`, `actor_id` (quando aplicável), `entity_type`/`entity_id`, e um payload específico do evento (`jsonb`).

## 13.3. Categorias de evento

| Categoria | Exemplos | Consumidores típicos |
|---|---|---|
| Ciclo de vida de entidade | `collection_item_created`, `marketplace_listing_published` | Analytics, Auditoria, Gamificação |
| Transacional/financeiro | `marketplace_transaction_completed`, `subscription_activated` | Notificações, Auditoria, Analytics, Pagamentos |
| Social | `trade_proposal_received`, `message_sent` | Notificações, Realtime |
| Sistema/IA | `ai_analysis_completed`, `offline_sync_completed` | Notificações, Analytics |
| Segurança | `mfa_enabled`, `session_revoked` | Auditoria, Notificações (e-mail de segurança) |

## 13.4. Garantias

- **At-least-once:** um evento pode, em cenário de falha, ser entregue mais de uma vez ao consumidor — todo consumidor de evento é desenhado para ser **idempotente** (processar o mesmo evento duas vezes não duplica efeito, ex.: notificação duplicada é deduplicada por `event_id`).
- **Ordem não garantida entre eventos de entidades diferentes**, mas garantida dentro da mesma entidade quando a ordem importa (ex.: `grading_records`, que é append-only, seção 14 detalha o mecanismo).

---

# 14. Event Bus

## 14.1. Implementação conceitual

O Event Bus do Numisphere não é um serviço de mensageria dedicado separado (ex.: Kafka) — nesta escala inicial, ele é implementado sobre a combinação de **triggers de banco + `pg_notify`/fila leve em Postgres + filas Redis** (seção 15), mantendo a stack dentro de Supabase + Redis já definida (`PROJECT_RULES.md` §3), com a porta aberta para migrar para um message broker dedicado caso o volume um dia justifique (decisão documentada como ADR quando ocorrer).

## 14.2. Publicação

Eventos de domínio são publicados de duas formas, conforme a origem:
- **Eventos originados de mutação direta de tabela:** um trigger de banco (ex.: `fn_emit_event`, complementar a `fn_audit_trigger` — `DATABASE.md` §6) publica o evento após o `insert`/`update` relevante.
- **Eventos originados de lógica de Application layer** (ex.: conclusão de uma análise de IA, que não é uma simples mutação de linha): a Edge Function/Server Action publica o evento explicitamente ao final da operação.

## 14.3. Consumo

Consumidores (Notification Dispatcher, agregador de Analytics, Gamificação) são **Edge Functions ou jobs periódicos** que leem da fila/tabela de eventos pendentes, processam, e marcam como processado — nunca consumidores acoplados de forma síncrona ao publicador (o publicador nunca espera o consumidor terminar).

## 14.4. Por que não acoplamento direto

Se "criar item" chamasse diretamente "enviar notificação de wishlist match", uma falha temporária no provedor de push derrubaria a criação do item. O Event Bus garante que a ação principal do usuário **sempre** conclui independentemente da saúde dos sistemas de reação (notificação, analytics, gamificação) — mesmo princípio de resiliência já aplicado à auditoria (`PROJECT_RULES.md` §18.4).

---

# 15. Filas

## 15.1. Papel

Filas absorvem trabalho que não precisa (ou não deve) ser executado de forma síncrona no caminho de resposta ao usuário: análise de IA, envio de notificação, geração de exportação/relatório, reprocessamento de imagem, agregação de analytics.

## 15.2. Implementação

Redis (já presente na stack para cache — `PROJECT_RULES.md` §3.1) também hospeda filas leves (listas/streams Redis) para os casos de baixa/média complexidade de orquestração. Cargas com necessidade de retry sofisticado, prioridade e observabilidade fina (ex.: fila de análise de IA, fila de processamento de imagem) usam um mecanismo de fila com garantias mais fortes sobre a mesma infraestrutura Redis (padrão produtor/consumidor com *dead-letter queue*).

## 15.3. Padrão de retry

Todo consumidor de fila aplica **backoff exponencial** com número máximo de tentativas; ao esgotar as tentativas, o item vai para uma fila de erro (*dead-letter*) e gera um alerta de observabilidade (seção 29) — nunca é descartado silenciosamente.

## 15.4. Filas nomeadas (visão lógica, não nomes de implementação)

| Fila lógica | Alimentada por | Consumida por |
|---|---|---|
| Análise de IA | Scanner/Identificação IA | Edge Function de IA |
| Notificações | Event Bus (todos os módulos) | Notification Dispatcher |
| Processamento de imagem | Upload (seção 5) | Pipeline de sanitização/otimização |
| Exportação/Relatórios | Módulo Exportação | Worker de geração de arquivo |
| Agregação de Analytics | Event Bus | Job periódico de agregação |
| Sincronização offline | Client (fila local) → servidor ao reconectar | Route Handlers padrão de cada domínio |

---

# 16. Cache

## 16.1. Camadas (retomando e detalhando `PROJECT_RULES.md` §20 / `DATABASE.md` §1.6, em nível de sistema)

```
CDN/Edge (Vercel) → Redis (aplicação) → TanStack Query (client) → Postgres (fonte de verdade)
```

## 16.2. O que é cacheado e por quê

| Dado | Camada | Motivo |
|---|---|---|
| Catálogo mestre (`catalog_items` etc.) | Redis + CDN (para páginas públicas SSG/ISR) | Alta leitura, baixíssima escrita |
| Cota de IA restante | Redis | Leitura frequente (exibida em UI), invalidação por evento de uso/renovação |
| Sessão de rate limiting | Redis | Necessidade de contagem rápida e expiração automática (TTL) |
| Resultado de busca de marketplace | Redis (TTL curto) | Alta leitura, tolerância a leve inconsistência |
| Dados privados do usuário (coleção, mensagens) | Apenas TanStack Query (client) | Nunca cache compartilhado entre usuários — dado privado |

## 16.3. Invalidação

- **Baseada em evento:** mutação relevante publica evento (seção 13) → consumidor de cache invalida a chave associada.
- **Baseada em TTL:** para dados de tolerância a leve desatualização (contadores agregados, resultados de busca).
- Nunca cache sem TTL "porque nunca muda" — todo dado tem uma janela de expiração definida, mesmo que longa (`PROJECT_RULES.md` §20.2).

## 16.4. Fallback

Se o Redis fica indisponível, o sistema **degrada, não quebra**: toda leitura cacheável tem um caminho direto ao Postgres como fallback — mais lento, porém correto. Nenhuma funcionalidade depende exclusivamente do cache para funcionar (`PROJECT_RULES.md` §20.5).

---

# 17. Edge Functions

## 17.1. Papel

Edge Functions (Supabase, runtime Deno) hospedam toda lógica que precisa de **privilégio elevado** (`service_role`), **integração com serviço externo** (provedor de IA, gateway de pagamento, e-mail transacional) ou **operação atômica multi-tabela** que não deve ser confiada à Application layer comum restrita por RLS do usuário (`PROJECT_RULES.md` §4.4, §11.1).

## 17.2. Catálogo lógico de Edge Functions

| Função | Disparada por | Responsabilidade |
|---|---|---|
| `ai-analysis-processor` | Fila de análise de IA (seção 15) | Chama provedor de IA externo, grava resultado, emite evento |
| `marketplace-transaction-finalizer` | Aceite de oferta (Application layer) | Transação atômica de venda (seção 7.3) |
| `trade-completion-finalizer` | Aceite mútuo de troca | Transferência atômica de propriedade (seção 8) |
| `payment-webhook-handler` | Webhook do gateway de pagamento | Valida assinatura, atualiza assinatura/plano (seção 9) |
| `notification-dispatcher` | Event Bus (seção 10/14) | Roteia evento para canais de notificação habilitados |
| `image-processing-pipeline` | Confirmação de upload (seção 5) | Sanitização, redimensionamento, geração de variantes |
| `export-report-generator` | Fila de exportação (seção 15) | Gera arquivo de relatório/exportação e disponibiliza download |
| `moderation-action-executor` | Ação de moderador/admin (Application layer) | Executa ação sensível, grava em `admin_actions`/`audit_logs` |
| `analytics-aggregator` | Job periódico (seção 21) | Agrega `user_events` em `aggregated_metrics` |
| `monthly-partition-manager` | Job periódico (seção 21) | Invoca `fn_create_monthly_partition` para tabelas particionadas |

## 17.3. Regras de design

- Toda Edge Function é **idempotente** sempre que disparada por evento/fila (alinhado à garantia at-least-once da seção 13.4).
- Nenhuma Edge Function expõe `service_role` ao client — a função é o único lugar onde essa credencial existe em memória de execução.
- Toda Edge Function crítica valida input com o mesmo rigor de um Route Handler público (`PROJECT_RULES.md` §11.4) — nunca assume que o payload que a disparou já foi validado a montante.
- Falhas são sempre capturadas e logadas (`system_logs`/`error_logs`) antes de re-lançar ou finalizar — nunca uma falha silenciosa que deixa um registro em estado inconsistente (ex.: `ai_analysis_requests.status=queued` para sempre).

---

# 18. Storage

Retoma e opera em runtime a estrutura definida em `DATABASE_ARCHITECTURE.md` §4 (buckets `avatars`, `coins`, `certificates`, `documents`, `chat`, `marketplace`, `catalog`, `temp`, `imports`, `exports`):

## 18.1. Ciclo de vida de um arquivo

```
Upload (seção 5) → bucket `temp` → confirmação →
image-processing-pipeline (seção 17.2) → arquivo final movido/copiado
ao bucket definitivo (`coins`, `certificates`, etc.) → storage_path
vinculado à entidade de domínio → arquivo em `temp` original expira
via job periódico (seção 21) se não confirmado em 24h
```

## 18.2. Controle de acesso

Acesso a arquivo privado nunca é direto — sempre via **signed URL de curta duração** (`API_CONVENTIONS` §9), gerada sob demanda por um Route Handler que primeiro valida a mesma regra de RLS/propriedade da entidade dona do arquivo (ex.: gerar signed URL de uma foto de `item_photos` reexecuta a checagem de visibilidade do `collection_item` pai antes de emitir a URL). Arquivos em buckets públicos (`catalog`, `avatars`, mídia de itens/anúncios públicos) são servidos diretamente pela CDN (seção 19), sem essa etapa.

## 18.3. Consistência com o banco

`storage_path` é sempre a fonte de verdade referenciada pelas tabelas (`item_photos.storage_path`, etc.) — nunca uma URL absoluta persistida (URLs mudam de forma/domínio conforme infraestrutura; paths não). Um arquivo órfão no Storage (sem linha correspondente no banco) é tratado como lixo a ser coletado pelo job de limpeza (seção 21), nunca como dado a se confiar.

---

# 19. CDN

## 19.1. Duas CDNs com papéis distintos

- **CDN de aplicação (Vercel Edge Network):** distribui HTML/JS/CSS/assets estáticos do PWA e páginas SSG/ISR (catálogo público, landing page) o mais próximo possível do usuário, reduzindo latência de primeiro carregamento (`PROJECT_RULES.md` §27).
- **CDN de mídia (Supabase Storage/CDN associada):** distribui imagens públicas (fotos de itens públicos, avatares, imagens de catálogo mestre) — nunca arquivos privados, que sempre passam pelo fluxo de signed URL (seção 18.2).

## 19.2. Estratégia de cache de CDN

Assets versionados por build (hash de conteúdo no nome do arquivo) recebem cache **imutável de longuíssima duração** — uma vez publicados, nunca mudam sob a mesma URL, então não há necessidade de invalidação. Páginas SSG/ISR usam `revalidate` consciente por rota (`PROJECT_RULES.md` §10.2), com a CDN servindo a versão em cache até o próximo ciclo de revalidação.

## 19.3. Invalidação de imagem pública

Quando uma imagem pública é atualizada (ex.: usuário troca a foto principal de um item público), o `storage_path` muda (novo arquivo, não sobrescrita in-place) — isso evita completamente o problema de invalidação de cache de CDN para mídia: a URL antiga simplesmente para de ser referenciada, a nova é servida sob um path novo.

---

# 20. Workers

## 20.1. Definição neste sistema

"Worker" aqui se refere a **qualquer unidade de execução assíncrona que consome de uma fila** (seção 15) — na prática, a maioria dos workers do Numora são as próprias Edge Functions da seção 17 quando disparadas por fila em vez de por requisição HTTP direta. Não existe, na arquitetura atual, um processo de worker de longa duração e estado persistente em memória — mantém-se a filosofia serverless/stateless de ponta a ponta (seção 1).

## 20.2. Escala de workers

Como cada invocação de Edge Function é independente e sem estado, a escala horizontal de processamento de fila é automática (a plataforma invoca quantas instâncias forem necessárias para drenar a fila, dentro dos limites de concorrência configurados) — não há gerenciamento manual de pool de workers.

## 20.3. Workers com maior necessidade de controle de concorrência

- `ai-analysis-processor`: concorrência limitada deliberadamente para respeitar rate limit do provedor de IA externo (nunca dispara mais chamadas simultâneas do que o provedor suporta).
- `payment-webhook-handler`: processamento serializado por `user_subscription_id` (nunca dois webhooks do mesmo usuário processados em paralelo, para evitar condição de corrida em `plan_tier`).

---

# 21. Background Jobs

Jobs periódicos (agendados, não disparados por evento) — distintos de workers de fila (seção 20), que reagem a algo que já aconteceu.

| Job | Frequência | Responsabilidade |
|---|---|---|
| `monthly-partition-manager` | Mensal (antecipado ao mês seguinte) | Cria partições futuras de tabelas particionadas (`audit_logs`, `system_logs`, `error_logs`, e futuramente `messages`/`notifications`/`user_events`) |
| `temp-storage-cleanup` | Diário | Remove arquivos em bucket `temp` não confirmados em 24h |
| `analytics-aggregator` | Diário (com opção de execução horária para métricas críticas) | Agrega `user_events` em `aggregated_metrics` |
| `subscription-renewal-check` | Diário | Verifica assinaturas a renovar/expirar, aciona recálculo de cota de IA |
| `ai-quota-reset` | Mensal, por ciclo de cobrança do usuário | Reseta contagem de cota de análises de IA |
| `stale-listing-reminder` | Semanal | Notifica vendedores de anúncios ativos há muito tempo sem interação |
| `wishlist-match-scanner` | Próximo a tempo real (frequência curta) ou disparado por evento de novo anúncio | Cruza novos `marketplace_listings`/`catalog_items` com `wishlist_items` para notificação de correspondência |
| `backup-restore-drill` | Trimestral (processo semi-manual assistido) | Executa e valida restauração de backup em ambiente isolado (`PROJECT_RULES.md` §19.2) |

**Regra geral:** todo job periódico é **seguro para re-execução** (idempotente) e registra seu resultado (sucesso/falha/quantidade processada) em `system_logs`, permitindo auditoria de que o job de fato rodou — silêncio nunca é interpretado como sucesso.

---

# 22. Realtime

## 22.1. Uso deliberadamente restrito

Supabase Realtime (canais websocket sobre replicação lógica do Postgres) é usado **apenas onde atualização ao vivo genuinamente importa para a experiência** (`DATABASE_ARCHITECTURE.md` §11.6) — nunca como mecanismo padrão de toda leitura de lista, que continua servida por TanStack Query + refetch/polling quando apropriado.

## 22.2. Canais em uso

| Canal | Escopo | Consumido por |
|---|---|---|
| Conversa (`conversation_id`) | Mensagens de uma conversa específica | Chat (seção 11) |
| Notificações do usuário (`user_id`) | Novas notificações in-app | Badge de notificação, lista de notificações |
| Status de análise de IA (`ai_analysis_requests.id`) | Progresso de uma requisição específica | Tela de resultado do Scanner/Identificação IA |
| Presença de oferta/anúncio (`listing_id`) | Novas ofertas em um anúncio do próprio usuário | Painel de vendedor no Marketplace |

## 22.3. Fallback

Todo componente que depende de Realtime tem um caminho de fallback por polling ou refetch manual (ex.: pull-to-refresh) caso a conexão websocket não se estabeleça (rede restritiva, navegador antigo) — Realtime é uma **melhoria de experiência**, nunca um requisito rígido de funcionamento (mesmo princípio de degradação graciosa da seção 16.4 aplicado a conectividade em tempo real).

---

# 23. Observabilidade

## 23.1. Três pilares

- **Logs** (seção 24) — o que aconteceu, em detalhe, evento a evento.
- **Métricas** — números agregados ao longo do tempo (latência p50/p95/p99, taxa de erro, throughput por rota, hit rate de cache) — alimentam dashboards e alertas.
- **Tracing** — capacidade de reconstruir o caminho completo de uma requisição específica através de Next.js → Edge Function → Postgres, via `request_id` correlacionado em toda camada (`PROJECT_RULES.md` §38.1).

## 23.2. Correlação ponta a ponta

Todo `request_id` gerado na borda (Route Handler/Server Action) é propagado explicitamente para: logs estruturados (seção 24), chamadas a Edge Functions subsequentes, e o header de resposta ao client — permitindo que um erro relatado pelo usuário seja rastreado até a cadeia completa de execução que o causou, sem precisar reproduzir o problema manualmente (`PROJECT_RULES.md` §38.1).

## 23.3. Rastreamento de erro de produto

Erros não tratados no client e no server são capturados por um provedor de rastreamento de erro dedicado (ex.: Sentry — `PROJECT_RULES.md` §37.2), agrupados por assinatura de erro e associados à versão de release (seção 38) em que ocorreram, nunca apenas registrados como linha de log isolada e desconectada do contexto de release.

---

# 24. Logs

Retoma em nível de sistema o que `PROJECT_RULES.md` §17 e `DATABASE_ARCHITECTURE.md` §6.2–6.3 já definem como política e schema:

## 24.1. Fluxo de escrita

```
Evento de log (aplicação/Edge Function) →
logger estruturado central (formato JSON, nunca console.log disperso) →
destino duplo:
  1. Provedor de log externo (observabilidade em tempo real, seção 23)
  2. audit.system_logs / audit.error_logs (Postgres, para correlação
     com dados de negócio e retenção própria — DATABASE.md §6.2-6.3)
```

## 24.2. Regra de dados sensíveis

Nenhum log (nenhuma das duas camadas do fluxo acima) contém senha, token, chave, ou dado pessoal completo não mascarado — mascaramento acontece **na origem** (no logger central), não como filtro posterior no destino, para garantir que o dado sensível nunca trafegue, nem temporariamente, para fora do processo que o gerou (`PROJECT_RULES.md` §17.3).

## 24.3. Retenção

Logs de aplicação (`system_logs`/`error_logs`) seguem retenção curta (semanas), suficiente para depuração operacional; dados que precisam de retenção longa por razão de negócio/compliance vivem em `audit_logs` (seção 25), não em `system_logs`.

---

# 25. Auditoria

Retoma em nível de sistema `DATABASE_ARCHITECTURE.md` §6.1 e §6.4:

## 25.1. Escrita desacoplada

A auditoria nunca é uma chamada síncrona bloqueante dentro da lógica de negócio principal — é implementada via **trigger de banco** (`fn_audit_trigger`) para mutações diretas de tabela, e via **emissão explícita de evento de auditoria** (seção 13/14) para ações de Application layer que não são uma simples mutação de linha (ex.: login, conclusão de transação). Em ambos os casos, uma falha ao gravar auditoria nunca reverte nem impede a operação de negócio original — gera alerta de observabilidade (seção 23) em vez disso.

## 25.2. Imutabilidade em runtime

Nenhuma camada do sistema — nem Route Handler, nem Edge Function, nem operação administrativa — tem caminho de código para `UPDATE`/`DELETE` em `audit_logs`. A garantia não depende de disciplina de código: é reforçada estruturalmente por RLS (`DATABASE_ARCHITECTURE.md` §6.1) como última linha de defesa, mesmo contra um bug futuro que tentasse violar essa regra.

## 25.3. Uso de auditoria além de compliance

Além do papel de segurança/compliance, `audit_logs` alimenta funcionalidades de produto legítimas (ex.: histórico de alterações visível ao próprio usuário em uma ficha de item) — um mesmo dado serve dois propósitos, evitando duplicar infraestrutura de "histórico" e "auditoria" separadamente.

---

# 26. Segurança

Consolida, em nível de sistema, as camadas de segurança já especificadas de forma distribuída em `PROJECT_RULES.md` §13–14 e `DATABASE_ARCHITECTURE.md` §7:

## 26.1. Defesa em profundidade (visão de sistema)

```
Edge/CDN (headers de segurança, TLS) →
Route Handler/Server Action (validação Zod, rate limiting) →
Application layer (checagem de autorização por papel/propriedade) →
RLS no Postgres (última linha de defesa, fail-closed) →
Auditoria (detecção/investigação pós-fato)
```

Nenhuma camada isolada é considerada suficiente — um bug ou bypass em qualquer uma delas ainda encontra as camadas seguintes intactas.

## 26.2. Segredos e credenciais

`service_role` e demais segredos existem exclusivamente em ambiente de execução server-side (Edge Functions, variáveis de ambiente do servidor Next.js) — nunca em bundle de client, nunca em log (seção 24.2), nunca em resposta de API.

## 26.3. Superfícies de ataque monitoradas

Rotas públicas de maior sensibilidade (login, cadastro, reset de senha, webhooks de pagamento) recebem rate limiting mais agressivo (`API_CONVENTIONS` §10) e são as primeiras cobertas por qualquer nova camada de proteção (ex.: verificação adicional de bot/abuso), por serem os vetores mais prováveis de ataque automatizado.

---

# 27. Escalabilidade

Retoma `DATABASE_ARCHITECTURE.md` §1.3/§40 em nível de sistema completo (não apenas banco):

## 27.1. Escala por camada

| Camada | Mecanismo de escala |
|---|---|
| Presentation/Application (Next.js) | Escala horizontal automática via Edge Network — sem servidor dedicado a gerenciar |
| Edge Functions | Escala horizontal automática por invocação — mesma lógica |
| Postgres | Connection pooling (Supabase Pooler) + read replicas quando a carga de leitura justificar |
| Redis | Escala vertical inicial, particionamento/cluster quando o volume de cache/fila justificar |
| Storage/CDN | Escala nativa do provedor, sem intervenção |

## 27.2. Gargalo primário a vigiar

Como a camada de aplicação escala automaticamente por design serverless, o **banco de dados é o recurso que exige atenção ativa** de engenharia conforme a base cresce — daí o cuidado extra em índices, paginação obrigatória e particionamento já embutido desde o schema inicial (`DATABASE_ARCHITECTURE.md` §1.3), em vez de tratado como otimização futura.

## 27.3. Testes de carga

Executados antes de marcos relevantes de crescimento (lançamento público, campanha de aquisição paga em escala), validando os alvos de performance (seção 35) sob concorrência realista — não apenas sob uso isolado de desenvolvimento (`PROJECT_RULES.md` §40.5).

---

# 28. Disaster Recovery

## 28.1. Cenários cobertos

| Cenário | Estratégia de resposta |
|---|---|
| Corrupção/perda de dado no Postgres | Restauração via PITR (Point-in-Time Recovery — `PROJECT_RULES.md` §19.1), testada trimestralmente (job da seção 21) |
| Indisponibilidade do provedor de IA externo | Fallback automático para catalogação manual (seção 6) — nunca um ponto único de falha do fluxo central de catalogação |
| Indisponibilidade do Redis | Degradação graciosa para leitura direta do Postgres (seção 16.4) |
| Indisponibilidade da Vercel/Edge Network | Fora do controle direto da equipe — mitigado por escolha de provedor com SLA adequado; comunicação transparente ao usuário via canal de status, se aplicável |
| Vazamento/incidente de segurança envolvendo dado pessoal | Processo de resposta a incidente com avaliação de comunicação à ANPD/titulares (`PROJECT_RULES.md` §41.8) |
| Erro de deploy que introduz regressão crítica | Rollback automatizado de um clique (seção 39) |

## 28.2. RPO/RTO

Alvos formais definidos e revisados conforme crescimento (`PROJECT_RULES.md` §19.4): **RPO ≤ 15 minutos** (via PITR) e **RTO ≤ 4 horas** em produção — todo plano de disaster recovery é avaliado contra esses dois números, não apenas contra "o backup existe".

## 28.3. Comunicação em incidente

Todo incidente relevante (indisponibilidade prolongada, incidente de segurança) tem um responsável designado de comunicação com os usuários — nunca um silêncio prolongado que erode confiança, alinhado ao Valor de Transparência (`BUSINESS_MODEL.md` §3).

---

# 29. Monitoramento

## 29.1. O que é monitorado continuamente

- **Disponibilidade (uptime)** das superfícies críticas: app web, Edge Functions de maior criticidade (pagamento, autenticação, IA).
- **Taxa de erro** por rota/Edge Function (p95 de erro acima de limiar aciona alerta).
- **Latência** por rota crítica (p50/p95/p99), com foco especial nas metas de Core Web Vitals (`PROJECT_RULES.md` §27.1) e nos endpoints de catalogação (fluxo mais usado do produto).
- **Saúde de fila** (profundidade da fila de análise de IA, idade da mensagem mais antiga não processada) — fila crescendo sem consumo é sinal precoce de problema no worker/Edge Function consumidora.
- **Cota/consumo de provedores externos** (IA, e-mail transacional, gateway de pagamento) — para antecipar limites de rate/custo antes que afetem usuários.

## 29.2. Alertas

Todo alerta tem **limiar (threshold) explícito** e **dono definido** (quem é acionado) — nunca um alerta configurado sem responsável claro (`PROJECT_RULES.md` §37.4). Alertas de maior severidade (indisponibilidade de autenticação/pagamento) têm canal de notificação imediato (ex.: chamada/SMS), diferente de alertas informativos (ex.: fila de exportação um pouco lenta), que vão a um canal assíncrono.

## 29.3. Health checks

Endpoint de health check dedicado expõe o estado das dependências críticas (Postgres, Redis) para verificação externa contínua por ferramenta de monitoramento (`PROJECT_RULES.md` §37.5), permitindo detecção de degradação antes mesmo de um usuário reportar problema.

---

## Nota de progresso (remover ao concluir o documento)

Lote 2 cobre as seções 17–29: Edge Functions, Storage, CDN, Workers, Background Jobs, Realtime, Observabilidade, Logs, Auditoria, Segurança, Escalabilidade, Disaster Recovery e Monitoramento.

Pendente para o próximo lote — seções 30–40 + diagrama Mermaid final:
Diagramas textuais, Dependências entre módulos, Comunicação entre serviços, Estratégia Offline, Sincronização, Performance, Deploy, Ambientes, Versionamento, CI/CD, Roadmap técnico, e o diagrama Mermaid completo (última entrega do documento).
