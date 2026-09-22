-- ============================================================================
-- Etapa "Admin Subscriptions V1" — correção de tipo em
-- `admin_list_subscriptions()`.
--
-- ACHADO (Fase 3 desta mesma etapa, teste de integração real via RPC —
-- nunca detectável só pela query bruta em SQL): `plan_prices.currency` é
-- `character(3)` (bpchar), não `text`. A declaração `returns table (...
-- currency text ...)` original causava, em toda chamada real da função
-- (mesmo com 0 linhas de resultado — Postgres valida a estrutura da query
-- contra o RETURNS TABLE independentemente da contagem de linhas):
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type character(3) does not match expected type text
--   in column 8.
--
-- CORREÇÃO: `pp.currency::text` explícito no SELECT — mesma abordagem já
-- usada em outras partes do projeto para bpchar→text (ex.:
-- `purchases.currency`). Nenhuma outra coluna, filtro, grant ou checagem de
-- autorização muda nesta migration.
-- ============================================================================

create or replace function public.admin_list_subscriptions(
  p_limit int default 50,
  p_offset int default 0,
  p_status_filter text default null,
  p_plan_filter text default null,
  p_currency_filter text default null,
  p_cancel_scheduled_only boolean default false,
  p_search text default null
)
returns table (
  subscription_id uuid,
  user_id uuid,
  user_name text,
  user_email text,
  plan_slug text,
  status text,
  "interval" text,
  currency text,
  amount numeric,
  created_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  canceled_at timestamptz,
  trial_end timestamptz,
  scheduled_plan_slug text,
  stripe_customer_id text,
  stripe_subscription_id text,
  last_transaction_status text,
  last_transaction_paid_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas administradores podem listar assinaturas.' using errcode = '42501';
  end if;

  return query
  select
    s.id as subscription_id,
    s.user_id,
    pr.name as user_name,
    pr.email as user_email,
    pl.slug as plan_slug,
    s.status,
    pp.interval as "interval",
    pp.currency::text as currency,
    pp.amount,
    s.created_at,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.canceled_at,
    s.trial_end,
    sp.slug as scheduled_plan_slug,
    bc.stripe_customer_id,
    s.stripe_subscription_id,
    lt.status as last_transaction_status,
    lt.paid_at as last_transaction_paid_at,
    count(*) over() as total_count
  from public.subscriptions s
  join public.profiles pr on pr.id = s.user_id
  join public.plans pl on pl.id = s.plan_id
  join public.billing_customers bc on bc.id = s.billing_customer_id
  left join public.plan_prices pp on pp.stripe_price_id = s.stripe_price_id
  left join public.plans sp on sp.id = s.scheduled_plan_id
  left join lateral (
    select bt.status, bt.paid_at
    from public.billing_transactions bt
    where bt.subscription_id = s.id
    order by bt.created_at desc
    limit 1
  ) lt on true
  where (p_status_filter is null or s.status = p_status_filter)
    and (p_plan_filter is null or pl.slug = p_plan_filter)
    and (p_currency_filter is null or pp.currency = p_currency_filter)
    and (not p_cancel_scheduled_only or s.cancel_at_period_end)
    and (
      p_search is null or p_search = '' or
      pr.email ilike '%' || p_search || '%' or
      pr.name ilike '%' || p_search || '%'
    )
  order by s.created_at desc
  limit least(coalesce(p_limit, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_list_subscriptions(int, int, text, text, text, boolean, text) from public, anon;
grant execute on function public.admin_list_subscriptions(int, int, text, text, text, boolean, text) to authenticated;

comment on function public.admin_list_subscriptions(int, int, text, text, text, boolean, text) is
  'Admin Subscriptions V1 — lista paginada/filtrada de assinaturas Stripe REAIS (public.subscriptions), nunca benefit_grants/internal_test/Conta de Análise. Somente admin/owner (is_platform_admin()). search_path vazio, tudo schema-qualificado. Somente leitura, limite 200/página. currency explicitamente convertida de bpchar(3) para text (plan_prices.currency).';
