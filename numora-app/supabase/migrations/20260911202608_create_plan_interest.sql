-- ============================================================================
-- Etapa "5.10S — Pro Interest / Pré-lançamento" — captura de intenção de
-- pagamento durante o Beta Fechado. Nunca cobra, nunca cria Checkout,
-- nunca chama Stripe — só registra que um usuário JÁ AUTENTICADO (convite
-- manual, signup público está fechado — ver auditoria 5.10 Product) quer
-- ser avisado quando um plano pago estiver disponível para contratação.
--
-- Clona deliberadamente o padrão de RLS já testado em `feedbacks`
-- (20260904200000_create_feedbacks.sql): `user_id` só é confiável quando
-- resolvido da sessão (auth.uid()), nunca aceito do cliente — o
-- repository (features/billing/repositories/plan-interest.repository.ts)
-- nunca envia user_id no INSERT.
--
-- `user_id references auth.users(id)` (não `public.profiles(id)` como
-- feedbacks): esta tabela não precisa de nenhum dado de perfil, só da
-- identidade do usuário — `on delete cascade` já cobre a exclusão de
-- conta (delete_own_account_data() apaga o usuário em auth.users no fim
-- da cadeia) sem precisar de mais uma dependência cruzada com profiles
-- para uma tabela deste tamanho.
--
-- Nenhum e-mail é armazenado aqui (requisito explícito da etapa) — o
-- e-mail, quando necessário para contato, é sempre resolvido via
-- auth.users/profiles a partir de user_id, nunca duplicado nesta tabela.
--
-- UNIQUE(user_id, plan_slug) é a garantia real de idempotência — nunca uma
-- checagem "select antes de insert" em 2 passos no client (teria uma race
-- condition sob duplo clique); o repository trata a violação de
-- unicidade (23505) como sucesso idempotente, nunca como erro visível.
--
-- GRANTS: mesma filosofia de `analytics_outbox`
-- (20260910195408_create_analytics_outbox.sql) — Supabase concede ALL a
-- `anon`/`authenticated` por padrão em toda tabela nova; esta migration já
-- nasce no estado final "endurecido" (equivalente ao que
-- harden_public_table_grants_production fez retroativamente para
-- `feedbacks`), em vez de esperar uma futura migration de hardening:
-- `anon` fica com ZERO privilégios (nenhuma policy é criada para ele,
-- reforçado por REVOKE ALL); `authenticated` fica só com INSERT/SELECT
-- (RLS decide QUAIS linhas) — sem UPDATE/DELETE/TRUNCATE, porque não há
-- nenhum caso de uso de editar ou apagar um registro de interesse (nem
-- para o próprio autor, nem para admin — diferente de `feedbacks`, aqui
-- não existe um `_update_admin`).
-- ============================================================================

create table public.plan_interest (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  plan_slug   text not null check (plan_slug in ('pro', 'premium')),
  source      text,
  created_at  timestamptz not null default now(),
  constraint uq_plan_interest_user_plan unique (user_id, plan_slug)
);

comment on table public.plan_interest is
  'Etapa "5.10S — Pro Interest" — sinal de intenção de pagamento registrado por um usuário beta autenticado (nunca uma cobrança real, nunca um Checkout). Nenhum e-mail é armazenado aqui — sempre resolvido via auth.users/profiles a partir de user_id quando necessário.';

comment on column public.plan_interest.source is
  'Reaproveita os mesmos valores de UpgradeViewedTrigger (lib/analytics/events/paywall-events.ts) — nunca uma taxonomia paralela.';

create index idx_plan_interest_user on public.plan_interest (user_id);
create index idx_plan_interest_plan_slug on public.plan_interest (plan_slug);

alter table public.plan_interest enable row level security;

-- ----------------------------------------------------------------------------
-- RLS de `plan_interest` — mesmo padrão de `feedbacks`: usuário comum só
-- INSERT/SELECT da própria linha. Admin: SELECT de tudo (uso interno de
-- analytics/priorização — nunca UPDATE/DELETE, não há esse caso de uso).
-- Nenhuma policy para `anon` em nenhuma operação.
-- ----------------------------------------------------------------------------

create policy "plan_interest_insert_own"
  on public.plan_interest
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "plan_interest_select_own"
  on public.plan_interest
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "plan_interest_select_admin"
  on public.plan_interest
  for select
  to authenticated
  using (public.is_platform_admin());

comment on policy "plan_interest_select_own" on public.plan_interest is
  'Usuário lê só o próprio interesse registrado — aditiva a plan_interest_select_admin, nunca expõe o interesse de outro usuário.';

-- Endurecimento de GRANT (ver bloco de comentário do topo do arquivo).
revoke all on table public.plan_interest from anon;
revoke update, delete, truncate on table public.plan_interest from authenticated;
