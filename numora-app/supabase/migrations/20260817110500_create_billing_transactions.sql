-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — espelho local de Stripe Invoice/
-- PaymentIntent.
--
-- Alimenta relatório (futuras /admin/transactions, /admin/revenue) — NUNCA
-- deve ser usada para decidir acesso do usuário (Etapa 15.6 §4): a decisão
-- de acesso vem de `get_effective_plan()`/`subscriptions.status`, nunca de
-- "o usuário tem uma transação paga".
--
-- Trigger `check_transaction_user_matches_subscription` impede estado
-- impossível: uma transação vinculada a uma subscription de outro usuário.
--
-- Tabela criada VAZIA — nenhuma transação Stripe real existe.
-- ============================================================================

create table public.billing_transactions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  subscription_id           uuid references public.subscriptions (id) on delete set null,
  stripe_invoice_id         text,
  stripe_payment_intent_id  text,
  amount                    numeric(10, 2) not null check (amount >= 0),
  currency                  char(3) not null default 'BRL',
  status                    text not null check (status in ('paid', 'failed', 'pending', 'refunded')),
  created_at                timestamptz not null default now(),
  paid_at                   timestamptz,
  constraint uq_billing_transactions_stripe_invoice_id unique (stripe_invoice_id),
  constraint uq_billing_transactions_stripe_payment_intent_id unique (stripe_payment_intent_id)
);

comment on table public.billing_transactions is
  'Etapa 15.7 — espelho local de Stripe Invoice/PaymentIntent, só para relatório. Nunca usar para decidir acesso — isso vem de get_effective_plan()/subscriptions.status. Criada vazia.';

create index idx_billing_transactions_user_id on public.billing_transactions (user_id);
create index idx_billing_transactions_subscription_id on public.billing_transactions (subscription_id);
create index idx_billing_transactions_status on public.billing_transactions (status);
create index idx_billing_transactions_created_at on public.billing_transactions (created_at desc);

-- Impede estado impossível: transação vinculada a uma subscription cujo
-- user_id diverge do user_id da própria transação.
create or replace function public.enforce_transaction_user_matches_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subscription_id is not null
     and new.user_id <> (select s.user_id from public.subscriptions s where s.id = new.subscription_id) then
    raise exception 'billing_transactions.user_id deve corresponder ao user_id da subscription referenciada.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_transaction_user_matches_subscription() from public, anon, authenticated;

create trigger check_transaction_user_matches_subscription
  before insert or update on public.billing_transactions
  for each row
  execute function public.enforce_transaction_user_matches_subscription();

alter table public.billing_transactions enable row level security;

create policy "billing_transactions_select_admin"
  on public.billing_transactions
  for select
  using (public.is_platform_admin());

-- Nenhum GRANT de escrita para authenticated — a futura porta de escrita
-- é o webhook handler (server-side) ou uma RPC administrativa dedicada,
-- nenhuma das duas implementada nesta etapa.
revoke insert, update, delete on public.billing_transactions from authenticated;
