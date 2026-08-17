-- ============================================================================
-- Etapa 15.3 (Admin Control Center) — RPCs de leitura administrativa.
--
-- `auth.users` (schema interno do Supabase Auth) não é exposto via
-- PostgREST/RLS para `authenticated` — por isso `last_sign_in_at` ("último
-- acesso") só pode ser lido através de uma function `security definer`,
-- nunca de uma query direta do client. Mesmo raciocínio de
-- `get_public_passport` (Etapa Passport): a function expõe só os campos
-- necessários, nunca a linha inteira de `auth.users` (sem
-- encrypted_password, sem tokens, sem nada sensível).
--
-- "Membro ativo" = fez login nos últimos 30 dias (`last_sign_in_at >= now()
-- - 30 dias`). Definição documentada aqui — a única fonte de verdade para
-- essa métrica em toda a aplicação.
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
    (select count(*) from public.profiles where plan_tier = 'free'),
    (select count(*) from public.profiles where plan_tier = 'premium'),
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
  'Etapa 15.3 — métricas agregadas reais para o dashboard /admin. "Ativo" = last_sign_in_at nos últimos 30 dias. Nenhum dado de receita/assinatura (Stripe não configurado).';

-- ----------------------------------------------------------------------------

create or replace function public.admin_list_members(
  p_limit int default 50,
  p_offset int default 0,
  p_plan_filter text default null,
  p_search text default null
)
returns table (
  id uuid,
  numora_id text,
  email text,
  name text,
  username text,
  plan_tier text,
  role text,
  passport_public boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  courtesy_active boolean,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas administradores podem listar membros.' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.numora_id, p.email, p.name, p.username, p.plan_tier, p.role, p.passport_public, p.created_at,
    u.last_sign_in_at,
    exists (
      select 1 from public.benefit_grants bg
      where bg.user_id = p.id
        and bg.revoked_at is null
        and bg.starts_at <= now()
        and (bg.expires_at is null or bg.expires_at > now())
    ) as courtesy_active,
    count(*) over() as total_count
  from public.profiles p
  join auth.users u on u.id = p.id
  where (p_plan_filter is null or p.plan_tier = p_plan_filter)
    and (
      p_search is null or p_search = '' or
      p.email ilike '%' || p_search || '%' or
      p.name ilike '%' || p_search || '%' or
      p.username ilike '%' || p_search || '%'
    )
  order by p.created_at desc
  limit least(coalesce(p_limit, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_list_members(int, int, text, text) from public, anon;
grant execute on function public.admin_list_members(int, int, text, text) to authenticated;

comment on function public.admin_list_members(int, int, text, text) is
  'Etapa 15.3 — listagem paginada de membros para /admin/members. Limite travado em 200/página mesmo se o chamador pedir mais.';
