-- ============================================================================
-- Etapa 15.9.1-R3 (UI baseada em Plano Efetivo) — admin_list_members()
-- deixa de usar profiles.plan_tier (legado, binário free/premium) para o
-- plano exibido em /admin/members. Passa a consumir effective_plans(), a
-- mesma fonte única já usada por get_effective_plan()/admin_plan_
-- distribution()/admin_dashboard_metrics() (Etapa 15.9.1-R2).
--
-- ACHADO (Etapa 15.9.1-R3, Fase 1): esta RPC não foi tocada na R2 — só
-- admin_dashboard_metrics() foi corrigida lá. `/admin/members` continuava
-- sendo o único consumidor real de profiles.plan_tier além de
-- /dashboard/profile.
--
-- `cross join lateral public.effective_plans(p.id) ep`: chamada DENTRO da
-- mesma query (1 round-trip, set-based), nunca em loop client-side. Sem
-- `p_plan_filter`, o planner aplica ORDER BY + LIMIT/OFFSET sobre
-- `profiles` primeiro e só resolve `effective_plans()` para as linhas da
-- página atual (no máximo 200, mesmo teto já existente). Com
-- `p_plan_filter` informado, a filtragem depende do resultado de
-- `effective_plans()` por linha — mesmo trade-off, documentado no
-- relatório da etapa, de qualquer agregação sobre um campo derivado; ainda
-- assim continua sendo 1 única query no Postgres, nunca N chamadas HTTP
-- desde o client.
--
-- `courtesy_active` deixa de ser um EXISTS próprio contra benefit_grants
-- (4ª reimplementação do mesmo predicado, achado da Etapa 15.9.1-R1) e
-- passa a ser `ep.source = 'courtesy'` — a MESMA informação que
-- effective_plans() já calculou, sem reconsultar a tabela.
--
-- Coluna de retorno renomeada de `plan_tier` para `plan_slug` (agora
-- 'free'/'pro'/'premium', não mais binário) — mudança de contrato
-- coordenada nesta mesma etapa com o único consumidor real
-- (features/admin/repositories/admin.repository.ts). DROP + CREATE
-- necessário porque o shape de retorno muda (Postgres não permite
-- CREATE OR REPLACE alterar OUT params).
-- ============================================================================

drop function public.admin_list_members(int, int, text, text);

create function public.admin_list_members(
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
  plan_slug text,
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
    p.id, p.numora_id, p.email, p.name, p.username, ep.plan_slug, p.role, p.passport_public, p.created_at,
    u.last_sign_in_at,
    (ep.source = 'courtesy') as courtesy_active,
    count(*) over() as total_count
  from public.profiles p
  join auth.users u on u.id = p.id
  cross join lateral public.effective_plans(p.id) ep
  where (p_plan_filter is null or ep.plan_slug = p_plan_filter)
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
  'Etapa 15.9.1-R3 — plan_slug vem de effective_plans() (fonte única courtesy > subscription > free), não mais de profiles.plan_tier. courtesy_active = ep.source = ''courtesy'' (mesma fonte, sem reconsultar benefit_grants). Limite travado em 200/página.';
