-- ============================================================================
-- Etapa 15.3 (Admin Control Center) — fundação de planos comerciais.
--
-- NÃO substitui `profiles.plan_tier` (continua sendo a "fonte rápida de
-- verdade" para a UI, exatamente como documentado desde
-- `extend_profiles_columns`: "Sincronizada por `subscriptions` quando a
-- Fase 5 existir"). `plans`/`plan_features` são o catálogo preparatório
-- para essa sincronização futura (Stripe Billing) — nesta etapa é só
-- schema + seed, sem nenhuma escrita em `profiles.plan_tier` a partir
-- daqui, e sem nenhuma lógica de cobrança.
--
-- Mesmo padrão de tabela de referência já usado em `countries`/`metals`/
-- `grades`: leitura pública para autenticados (não é dado sensível — é
-- catálogo, análogo a uma tabela de preços pública), escrita restrita a
-- administradores via `is_platform_admin()`.
-- ============================================================================

create table public.plans (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  description      text,
  price            numeric(10, 2),
  billing_interval text,
  active           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint chk_plans_billing_interval check (billing_interval is null or billing_interval in ('month', 'year'))
);

comment on table public.plans is
  'Etapa 15.3 — catálogo de planos comerciais. Preparatório para Stripe Billing (fora de escopo desta etapa): nenhuma linha aqui está hoje vinculada a profiles.plan_tier.';
comment on column public.plans.active is
  'Só FREE nasce true nesta etapa — PRO/PREMIUM existem como catálogo, mas não são vendáveis enquanto não houver cobrança real.';

create trigger set_plans_updated_at
  before update on public.plans
  for each row
  execute function public.set_updated_at();

alter table public.plans enable row level security;

create policy "plans_select_authenticated"
  on public.plans
  for select
  to authenticated
  using (true);

create policy "plans_admin_write"
  on public.plans
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

insert into public.plans (name, slug, description, price, billing_interval, active) values
  ('Free', 'free', 'Plano padrão, sem custo.', 0, null, true),
  ('Pro', 'pro', 'Plano intermediário — catálogo preparatório, ainda não vendável.', 29.90, 'month', false),
  ('Premium', 'premium', 'Plano completo — catálogo preparatório, ainda não vendável.', 59.90, 'month', false);

-- ----------------------------------------------------------------------------

create table public.plan_features (
  plan_id    uuid not null references public.plans (id) on delete cascade,
  feature    text not null,
  enabled    boolean not null default true,
  "limit"    integer,
  primary key (plan_id, feature)
);

comment on table public.plan_features is
  'Etapa 15.3 — features/limites por plano. Ainda sem nenhum consumidor no código (nenhum can()/capabilities check existe hoje) — só a fundação de dados.';

alter table public.plan_features enable row level security;

create policy "plan_features_select_authenticated"
  on public.plan_features
  for select
  to authenticated
  using (true);

create policy "plan_features_admin_write"
  on public.plan_features
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
