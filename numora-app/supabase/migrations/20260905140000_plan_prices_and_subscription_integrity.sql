-- ============================================================================
-- Etapa "Stripe 3.4 — Fechamento das integridades pré-Stripe" — as 2
-- proteções estruturais aprovadas na análise "Stripe 3.3" (a sugestão de
-- CHECK com `now()` foi explicitamente rejeitada e NÃO está aqui — essa
-- regra fica para a futura RPC `activate_price_version` + scheduler,
-- nenhum dos dois criados nesta etapa).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) effective_until > effective_from (ou NULL) — mesmo padrão já usado em
--    `chk_subscriptions_period` (`20260817110300_create_subscriptions.sql`).
--    Não é enforçado por trigger: `effective_from`/`effective_until`
--    continuam livremente editáveis pelas futuras operações administrativas
--    (só os termos comerciais — plan_id/interval/currency/amount/
--    stripe_price_id — são protegidos por trigger, ver
--    `20260905130000_plan_prices_versioning.sql`).
-- ----------------------------------------------------------------------------
alter table public.plan_prices
  add constraint chk_plan_prices_effective_period
  check (effective_until is null or effective_until > effective_from);

comment on constraint chk_plan_prices_effective_period on public.plan_prices is
  'Etapa "Stripe 3.4" — effective_until, quando preenchido, precisa ser estritamente posterior a effective_from. NULL (ainda vigente) sempre permitido.';

-- ----------------------------------------------------------------------------
-- B) Coerência subscriptions.plan_id <-> plan_prices.plan_id — quando
--    subscriptions.stripe_price_id aponta para uma linha de plan_prices,
--    subscriptions.plan_id PRECISA ser o mesmo plan_id dessa linha. Mesmo
--    padrão já usado para `enforce_subscription_user_matches_billing_customer`
--    (`20260817110300_create_subscriptions.sql`): função `security definer`,
--    `revoke execute` de public/anon/authenticated, trigger `before insert
--    or update`. Isso NUNCA depende de RLS — dispara igual para
--    service_role/webhook, exatamente como a instrução desta etapa exige
--    ("não confiar em RLS para esta integridade").
--
--    stripe_price_id = NULL não exige correspondência nenhuma (subscription
--    ainda sem Price real vinculado, estado hoje inexistente em produção
--    mas coberto por segurança).
--
--    Nenhuma mudança em effective_plans()/get_effective_plan()/entitlements
--    — esta proteção é só sobre a integridade das colunas de subscriptions
--    entre si, nunca sobre como o plano efetivo é resolvido.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_subscription_plan_matches_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price_plan_id uuid;
begin
  if new.stripe_price_id is null then
    return new;
  end if;

  select pp.plan_id into v_price_plan_id
  from public.plan_prices pp
  where pp.stripe_price_id = new.stripe_price_id;

  if v_price_plan_id is null then
    raise exception 'subscriptions.stripe_price_id (%) não corresponde a nenhuma linha de plan_prices.', new.stripe_price_id
      using errcode = '23514';
  end if;

  if v_price_plan_id <> new.plan_id then
    raise exception 'subscriptions.plan_id (%) não corresponde ao plan_id (%) do plan_prices referenciado por stripe_price_id (%).',
      new.plan_id, v_price_plan_id, new.stripe_price_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_subscription_plan_matches_price() from public, anon, authenticated;

create trigger check_subscription_plan_matches_price
  before insert or update on public.subscriptions
  for each row
  execute function public.enforce_subscription_plan_matches_price();
