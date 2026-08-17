-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — espelho local de Stripe Subscription.
--
-- Fonte de verdade é sempre o Stripe (Etapa 15.6 §4) — esta tabela nunca é
-- escrita "otimisticamente" pelo client, só por um caminho futuro
-- server-side (webhook) ou por RPC administrativa dedicada (nenhuma das
-- duas existe ainda, ver Etapa 15.7 §9/pendências). Nenhuma policy de
-- escrita libera `authenticated` comum.
--
-- `status` NUNCA inclui 'courtesy' — cortesia é modelada exclusivamente em
-- `benefit_grants` (Etapa 15.6 §6, decisão reafirmada explicitamente nesta
-- etapa). Os 8 valores abaixo espelham os estados reais que uma Stripe
-- Subscription pode assumir.
--
-- Trigger `check_subscription_user_matches_billing_customer` impede um
-- estado impossível: uma subscription cujo `user_id` não corresponda ao
-- dono do `billing_customer_id` referenciado (rigor pedido explicitamente
-- na Etapa 15.7 §"CONSTRAINTS" — "não permitir estados impossíveis").
--
-- Tabela criada VAZIA — nenhuma Stripe Subscription real existe.
-- ============================================================================

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  billing_customer_id     uuid not null references public.billing_customers (id) on delete cascade,
  stripe_subscription_id  text not null,
  stripe_price_id         text,
  plan_id                 uuid references public.plans (id) on delete restrict,
  status                  text not null check (status in (
                             'trialing', 'active', 'past_due', 'canceled',
                             'incomplete', 'incomplete_expired', 'unpaid', 'paused'
                           )),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  canceled_at             timestamptz,
  trial_end               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint uq_subscriptions_stripe_subscription_id unique (stripe_subscription_id),
  constraint chk_subscriptions_period check (
    current_period_start is null or current_period_end is null or current_period_end > current_period_start
  )
);

comment on table public.subscriptions is
  'Etapa 15.7 — espelho local de Stripe Subscription. Fonte de verdade é o Stripe; esta tabela é sempre atualizada por webhook/RPC administrativa (futuro), nunca por escrita direta do client. status nunca inclui courtesy — cortesia é exclusivamente benefit_grants.';

create index idx_subscriptions_user_id on public.subscriptions (user_id);
create index idx_subscriptions_billing_customer_id on public.subscriptions (billing_customer_id);
create index idx_subscriptions_status on public.subscriptions (status);

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_updated_at();

-- Impede estado impossível: subscription.user_id divergente do dono do
-- billing_customer referenciado.
create or replace function public.enforce_subscription_user_matches_billing_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id <> (select bc.user_id from public.billing_customers bc where bc.id = new.billing_customer_id) then
    raise exception 'subscriptions.user_id deve corresponder ao user_id do billing_customer referenciado.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_subscription_user_matches_billing_customer() from public, anon, authenticated;

create trigger check_subscription_user_matches_billing_customer
  before insert or update on public.subscriptions
  for each row
  execute function public.enforce_subscription_user_matches_billing_customer();

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_admin"
  on public.subscriptions
  for select
  using (public.is_platform_admin());

create policy "subscriptions_owner_insert"
  on public.subscriptions
  for insert
  with check (public.is_platform_owner());

create policy "subscriptions_owner_update"
  on public.subscriptions
  for update
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create policy "subscriptions_owner_delete"
  on public.subscriptions
  for delete
  using (public.is_platform_owner());
