-- ============================================================================
-- Etapa 15.9.1-R2 (Fonte Única de Plano Efetivo) — admin_dashboard_metrics()
-- deixa de usar profiles.plan_tier (legado, binário free/premium, nunca
-- sincronizado por subscription/courtesy — Etapa 15.9.1-R1 §3) para
-- free_members/premium_members. Passa a consumir effective_plans(), a
-- mesma fonte única usada por get_effective_plan()/admin_plan_distribution().
--
-- Contrato público INALTERADO de propósito (Etapa 15.9.1-R2, escopo
-- explícito): a RPC continua retornando as mesmas 10 colunas, nas mesmas
-- posições/tipos — nenhum consumidor existente (app/admin/page.tsx) quebra.
-- `premium_members` passa a significar "qualquer plano pago" (pro OU
-- premium via effective_plans() — mesma soma que apareceria nos cards
-- "Pro"+"Premium" do novo card "Distribuição por plano" do Owner Center),
-- não mais um campo binário do catálogo antigo. Uma eventual 3ª coluna
-- `pro_members` — ou a aposentadoria completa desta seção do card em favor
-- do card novo, que já é 100% correto — fica para uma etapa futura
-- (Etapa 15.9.1-R1 §13/pendências), não decidida aqui.
--
-- `profiles.plan_tier` (coluna) NÃO foi alterada, removida, nem teve o
-- CHECK modificado — só deixou de ser lida por esta RPC. Continua sendo
-- lida por /dashboard/profile e /admin/members (fora do escopo desta
-- etapa, ver relatório).
-- ============================================================================

create or replace function public.admin_dashboard_metrics()
returns table (
  total_members bigint,
  active_members_30d bigint,
  free_members bigint,
  premium_members bigint,
  courtesy_active bigint,
  coins_count bigint,
  units_count bigint,
  purchases_count bigint,
  passports_published bigint,
  images_stored bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas administradores podem consultar métricas administrativas.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles p join auth.users u on u.id = p.id
       where u.last_sign_in_at >= now() - interval '30 days'),
    (select count(*) from public.effective_plans() ep where ep.plan_slug = 'free'),
    (select count(*) from public.effective_plans() ep where ep.plan_slug in ('pro', 'premium')),
    (select count(*) from public.benefit_grants
       where revoked_at is null and starts_at <= now() and (expires_at is null or expires_at > now())),
    (select count(*) from public.collection_items where deleted_at is null),
    (select count(*) from public.collection_units cu
       join public.collection_items ci on ci.id = cu.collection_item_id
       where ci.deleted_at is null),
    (select count(*) from public.purchases),
    (select count(*) from public.profiles where passport_public = true),
    (select count(*) from public.coin_images);
end;
$$;

revoke execute on function public.admin_dashboard_metrics() from public, anon;
grant execute on function public.admin_dashboard_metrics() to authenticated;

comment on function public.admin_dashboard_metrics() is
  'Etapa 15.9.1-R2 — free_members/premium_members agora vêm de effective_plans() (fonte única courtesy > subscription > free), não mais de profiles.plan_tier (legado, nunca sincronizado). premium_members = pro + premium combinados (contrato de 2 colunas preservado). "Ativo" continua = last_sign_in_at nos últimos 30 dias.';
