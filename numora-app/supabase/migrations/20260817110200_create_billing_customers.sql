-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — vínculo 1:1 profiles ↔ Stripe Customer.
--
-- `stripe_customer_id` nasce NULLABLE de propósito: a arquitetura (Etapa
-- 15.6 §5) permite criar este registro antes ou durante o primeiro
-- Checkout futuro — não há hoje nenhum Customer Stripe real para vincular
-- (Stripe fora de escopo desta etapa, §9). UNIQUE em coluna nullable
-- permite múltiplas linhas com `stripe_customer_id is null`
-- simultaneamente (comportamento padrão do Postgres: NULL <> NULL para
-- fins de UNIQUE) — só passa a exigir unicidade real quando o valor for
-- preenchido.
--
-- Tabela criada VAZIA nesta etapa — nenhum Customer Stripe foi inventado,
-- nenhum usuário existente foi retroativamente vinculado.
-- ============================================================================

create table public.billing_customers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_billing_customers_user unique (user_id),
  constraint uq_billing_customers_stripe_customer_id unique (stripe_customer_id)
);

comment on table public.billing_customers is
  'Etapa 15.7 — vínculo 1:1 entre profiles e Stripe Customer. stripe_customer_id nullable (registro pode existir antes do primeiro Checkout). Criada vazia — Stripe não está integrado.';

create trigger set_billing_customers_updated_at
  before update on public.billing_customers
  for each row
  execute function public.set_updated_at();

alter table public.billing_customers enable row level security;

-- ADMIN pode visualizar dados operacionais (Etapa 15.7 — OWNER vs ADMIN);
-- is_platform_admin() já inclui owner (role in ('owner','admin')).
create policy "billing_customers_select_admin"
  on public.billing_customers
  for select
  using (public.is_platform_admin());

-- Escrita (criação/atualização/remoção do vínculo com Stripe) é ação
-- financeira/comercial — exclusiva do OWNER. Usuário comum não tem
-- NENHUMA policy de escrita aqui (nem para a própria linha): nenhum
-- consumidor de self-service existe ainda, e reassociação arbitrária de
-- user_id nunca deve ser possível pelo client.
create policy "billing_customers_owner_write"
  on public.billing_customers
  for insert
  with check (public.is_platform_owner());

create policy "billing_customers_owner_update"
  on public.billing_customers
  for update
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create policy "billing_customers_owner_delete"
  on public.billing_customers
  for delete
  using (public.is_platform_owner());
