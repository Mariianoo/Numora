-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — preço por plano×intervalo.
--
-- `plans.price`/`plans.billing_interval` (Etapa 15.3) modelam UM preço por
-- plano — insuficiente assim que "mensal e anual para o mesmo plano"
-- existir (Stripe modela isso como dois Price distintos do mesmo
-- Product). Esta tabela é ADITIVA: `plans` continua intocada (nenhuma
-- coluna removida/alterada, nenhum preço comercial modificado) e
-- representa só o catálogo (nome/slug/descrição/`active`) — `plan_prices`
-- passa a ser onde a granularidade de preço por intervalo vive daqui em
-- diante. Não duplica "plano": é 1:N (um plano pode ter 0, 1 ou 2 linhas
-- aqui — mensal/anual), nunca uma cópia do conceito de plano em si.
--
-- Tabela criada VAZIA nesta etapa — nenhum preço comercial foi
-- autorizado para popular `plan_prices` (decisão de negócio separada,
-- fora do escopo desta fundação técnica). `stripe_price_id` nasce nulo
-- em todo caso: nenhum Price foi criado no Stripe (fora de escopo,
-- Etapa 15.7 §9).
-- ============================================================================

create table public.plan_prices (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.plans (id) on delete cascade,
  stripe_price_id   text,
  "interval"        text not null check ("interval" in ('month', 'year')),
  amount            numeric(10, 2) not null check (amount >= 0),
  currency          char(3) not null default 'BRL',
  active            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_plan_prices_plan_interval unique (plan_id, "interval"),
  constraint uq_plan_prices_stripe_price_id unique (stripe_price_id)
);

comment on table public.plan_prices is
  'Etapa 15.7 — preço por plano×intervalo (mensal/anual), preparatório para múltiplos Stripe Price por Product. Aditiva a plans (não a substitui, não duplica o conceito de plano). Criada vazia nesta etapa — nenhum preço comercial foi autorizado a popular esta tabela ainda.';

create index idx_plan_prices_plan_id on public.plan_prices (plan_id);

create trigger set_plan_prices_updated_at
  before update on public.plan_prices
  for each row
  execute function public.set_updated_at();

alter table public.plan_prices enable row level security;

-- Mesmo padrão de plans_select_authenticated/plan_features_select_authenticated
-- (Etapa 15.3): catálogo de preços é leitura pública para autenticados, não é
-- dado sensível.
create policy "plan_prices_select_authenticated"
  on public.plan_prices
  for select
  to authenticated
  using (true);

-- Divergência DELIBERADA de plans_admin_write/plan_features_admin_write
-- (que usam is_platform_admin()): preço é "configuração comercial",
-- listada explicitamente na Etapa 15.6 §8 como exclusiva do OWNER — admin
-- comum não deve conseguir alterar preços.
create policy "plan_prices_owner_write"
  on public.plan_prices
  for all
  using (public.is_platform_owner())
  with check (public.is_platform_owner());
