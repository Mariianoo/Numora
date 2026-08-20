-- ============================================================================
-- Etapa 15.10.7 (Numora Health / Owner Observability) — RPC agregada,
-- OWNER-only, para as métricas de Growth/Product Usage que hoje exigiriam
-- múltiplas queries.
--
-- SECURITY DEFINER + is_platform_owner() (já existente, não alterada) —
-- mesmo padrão de admin_plan_distribution() (a única outra RPC admin_*
-- restrita a OWNER, não a ADMIN). Nenhuma lógica de autorização nova.
--
-- Set-based, 2 scans no total (1x profiles, 1x collection_items), cada um
-- computando múltiplas métricas via FILTER na mesma passada — nunca 1
-- query por métrica, nunca 1 query por usuário. `deleted_at is null` nos
-- itens segue a mesma semântica de "itens ativos" já usada por
-- admin_dashboard_metrics() (coins_count).
--
-- Não toca effective_plans(), billing, subscriptions, benefit_grants,
-- plan_prices, billing_transactions, billing_webhook_events, RLS, ou
-- qualquer migration anterior.
-- ============================================================================

create or replace function public.admin_health_snapshot()
returns table (
  new_members_today bigint,
  new_members_7d bigint,
  new_members_30d bigint,
  total_collection_items bigint,
  members_with_item bigint,
  item_additions_7d bigint,
  item_additions_30d bigint
)
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Apenas o OWNER pode consultar o Numora Health.' using errcode = '42501';
  end if;

  return query
  select
    m.new_members_today,
    m.new_members_7d,
    m.new_members_30d,
    i.total_collection_items,
    i.members_with_item,
    i.item_additions_7d,
    i.item_additions_30d
  from (
    select
      count(*) filter (where created_at >= date_trunc('day', now())) as new_members_today,
      count(*) filter (where created_at >= now() - interval '7 days') as new_members_7d,
      count(*) filter (where created_at >= now() - interval '30 days') as new_members_30d
    from public.profiles
  ) m
  cross join (
    select
      count(*) filter (where deleted_at is null) as total_collection_items,
      count(distinct user_id) filter (where deleted_at is null) as members_with_item,
      count(*) filter (where deleted_at is null and created_at >= now() - interval '7 days') as item_additions_7d,
      count(*) filter (where deleted_at is null and created_at >= now() - interval '30 days') as item_additions_30d
    from public.collection_items
  ) i;
end;
$$;

revoke execute on function public.admin_health_snapshot() from public, anon;
grant execute on function public.admin_health_snapshot() to authenticated;

comment on function public.admin_health_snapshot() is
  'Etapa 15.10.7 — Numora Health, OWNER-only (is_platform_owner()). Agregação single-pass (profiles + collection_items, cada tabela escaneada 1x via FILTER) — novos membros hoje/7d/30d, itens ativos, membros com item, adições 7d/30d. Nunca reimplementa effective_plan/billing.';
