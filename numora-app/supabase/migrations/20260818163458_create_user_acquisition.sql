-- ============================================================================
-- Etapa 15.10.2 (Aquisição e Atribuição) — fundação de first-touch
-- attribution, dedicada e vinculada a `profiles` (nunca `auth.users.
-- raw_user_meta_data`, decisão explícita desta etapa: JSONB não indexado
-- em `auth.users` não escala para consultas analíticas em milhões de
-- linhas nem deveria competir por I/O com o caminho crítico de auth).
--
-- FIRST-TOUCH, nunca sobrescrita: `UNIQUE (user_id)` é a garantia real —
-- não uma convenção de aplicação. Todo INSERT client/server-side usa
-- `upsert(..., { onConflict: 'user_id', ignoreDuplicates: true })`, e
-- mesmo que algum caminho futuro tentasse um INSERT puro, a constraint
-- rejeitaria a 2ª linha. NENHUMA policy de UPDATE existe (ver abaixo) —
-- depois de escrita, a linha é imutável para todo mundo, inclusive OWNER.
--
-- `user_id` não é opcional/nullable — esta tabela só existe para
-- USUÁRIOS REAIS que completaram cadastro (o dado de visitante anônimo
-- vive só no cookie do navegador, nunca no banco, até a confirmação do
-- cadastro persistir aqui — ver app/auth/callback/route.ts e
-- features/auth/repositories/auth.repository.ts).
-- ============================================================================

create table public.user_acquisition (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  first_source   text,
  first_medium   text,
  first_campaign text,
  first_term     text,
  first_content  text,
  landing_path   text,
  referrer       text,
  captured_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint uq_user_acquisition_user_id unique (user_id)
);

comment on table public.user_acquisition is
  'Etapa 15.10.2 — first-touch attribution, 1 linha por usuário (UNIQUE user_id garante isso), nunca sobrescrita (sem policy de UPDATE). Fonte: cookie de atribuição capturado no navegador (lib/analytics/attribution.ts), só quando consent.marketing = true.';
comment on column public.user_acquisition.captured_at is
  'Momento real da primeira visita (client-supplied, do cookie) — pode ser dias antes de created_at (quando o cadastro precisa de confirmação de e-mail).';
comment on column public.user_acquisition.created_at is
  'Momento em que esta linha foi gravada no banco (server-generated) — na prática, o momento da confirmação de cadastro/primeira sessão.';
comment on column public.user_acquisition.referrer is
  'Só o hostname do referrer (ex.: "google.com"), nunca a URL completa — evita capturar querystring de terceiros por engano (Etapa 15.10.2, privacidade).';

-- Índices para as consultas analíticas explicitamente pedidas nesta etapa
-- (usuários/cadastros por source, medium, campaign, isolados ou
-- combinados). `user_id` já tem índice único implícito pela constraint
-- acima — nenhum índice adicional para ele. Nenhum índice em
-- first_term/first_content/landing_path/referrer: não fazem parte do
-- conjunto de dimensões de relatório pedido, e criar índice sem consumidor
-- real violaria "não criar índices desnecessários".
create index idx_user_acquisition_first_source on public.user_acquisition (first_source);
create index idx_user_acquisition_first_medium on public.user_acquisition (first_medium);
create index idx_user_acquisition_first_campaign on public.user_acquisition (first_campaign);
-- Composto: cobre relatórios que agrupam/filtram por mais de uma dimensão
-- ao mesmo tempo (ex.: "google/cpc/campanha_x" como unidade) — os 3
-- índices simples acima não substituem este (prefixo à esquerda só
-- acelera first_source sozinho ou first_source+first_medium, nunca
-- first_medium/first_campaign isolados quando não são a coluna líder).
create index idx_user_acquisition_source_medium_campaign
  on public.user_acquisition (first_source, first_medium, first_campaign);

alter table public.user_acquisition enable row level security;

-- Usuário só lê a PRÓPRIA atribuição — mesmo padrão de profiles_select_own.
create policy "user_acquisition_select_own"
  on public.user_acquisition
  for select
  using ((select auth.uid()) = user_id);

-- ADMIN/OWNER leem qualquer linha, para relatório futuro no Owner Center
-- (Etapa 15.10.2 §"OWNER CENTER" — "a estrutura deve permitir
-- futuramente"). is_platform_admin() reutilizada sem alteração — mesma
-- régua já usada para billing_customers/subscriptions (dado operacional
-- de suporte, não configuração comercial que exigiria is_platform_owner()
-- como plans/plan_prices/plan_entitlements/benefit_grants).
create policy "user_acquisition_select_admin"
  on public.user_acquisition
  for select
  using (public.is_platform_admin());

-- Usuário só grava a PRÓPRIA linha, nunca em nome de outro — o `with
-- check` já é suficiente aqui (diferente de benefit_grants.created_by,
-- não há campo derivado que precise de um trigger para não confiar no
-- client: user_id É o próprio campo verificado).
create policy "user_acquisition_insert_own"
  on public.user_acquisition
  for insert
  with check ((select auth.uid()) = user_id);

-- Nenhuma policy de UPDATE para ninguém — imutável após a escrita (a
-- garantia real de "first-touch nunca sobrescrita" é a ausência desta
-- policy, não só a UNIQUE constraint).
--
-- DELETE só para OWNER — não para correção/edição (que não deveria
-- existir), só para eventual pedido de exclusão (LGPD/direito ao
-- esquecimento) tratado manualmente.
create policy "user_acquisition_owner_delete"
  on public.user_acquisition
  for delete
  using (public.is_platform_owner());
