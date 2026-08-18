-- ============================================================================
-- Etapa 15.8 (Modelo Comercial + Entitlements) — funções de consulta de
-- entitlement, únicas no projeto (nenhum outro lugar deve consultar
-- `plan_entitlements` diretamente).
--
-- Fluxo: get_effective_plan(user) → plan_id → plan_entitlements →
-- get_entitlement(). Cortesia nunca é tratada como caso especial aqui —
-- `get_effective_plan()` já resolve "qual plano vale agora" (cortesia >
-- subscription > free); estas funções só leem o `plan_id` resultante,
-- nunca reimplementam a prioridade cortesia/subscription.
--
-- Autorização: mesmo padrão de `get_effective_plan()` (Etapa 15.7) —
-- usuário só consulta a PRÓPRIA linha, salvo admin/owner
-- (`is_platform_admin()`, que já cobre ambos). Nunca expõe se um terceiro
-- tem acesso a um recurso para um usuário comum.
--
-- Fail-closed: se não existir uma linha de `plan_entitlements` para
-- (plano efetivo, feature_key), `get_entitlement()` retorna
-- `enabled = false` — NUNCA assume "liberado" por ausência de
-- configuração. `limit_value = NULL` (quando enabled=true) significa
-- ILIMITADO, documentado explicitamente na migration anterior.
-- ============================================================================

create or replace function public.get_entitlement(p_user_id uuid, p_feature_key text)
returns table (
  enabled boolean,
  limit_value integer,
  plan_slug text,
  source text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan record;
  v_ent record;
begin
  if p_user_id <> (select auth.uid()) and not public.is_platform_admin() then
    raise exception 'Não autorizado a consultar entitlements de outro usuário.' using errcode = '42501';
  end if;

  select ep.plan_slug, ep.plan_id, ep.source into v_plan
  from public.get_effective_plan(p_user_id) ep;

  select pe.enabled, pe.limit_value into v_ent
  from public.plan_entitlements pe
  where pe.plan_id = v_plan.plan_id and pe.feature_key = p_feature_key;

  if found then
    return query select v_ent.enabled, v_ent.limit_value, v_plan.plan_slug, v_plan.source;
  else
    return query select false, null::integer, v_plan.plan_slug, v_plan.source;
  end if;
end;
$$;

revoke execute on function public.get_entitlement(uuid, text) from public, anon;
grant execute on function public.get_entitlement(uuid, text) to authenticated;

comment on function public.get_entitlement(uuid, text) is
  'Etapa 15.8 — única função de leitura de plan_entitlements. Usa get_effective_plan() internamente (nunca reimplementa a prioridade cortesia/subscription/free). Fail-closed: feature sem linha configurada para o plano = enabled=false, nunca liberado por omissão.';

-- ----------------------------------------------------------------------------

create or replace function public.check_entitlement_limit(p_user_id uuid, p_feature_key text, p_current_value integer)
returns table (
  allowed boolean,
  limit_value integer,
  current_value integer,
  remaining integer,
  plan_slug text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_ent record;
begin
  if p_user_id <> (select auth.uid()) and not public.is_platform_admin() then
    raise exception 'Não autorizado a consultar limites de outro usuário.' using errcode = '42501';
  end if;

  select e.enabled, e.limit_value, e.plan_slug
  into v_ent
  from public.get_entitlement(p_user_id, p_feature_key) e;

  if not v_ent.enabled then
    return query select false, v_ent.limit_value, p_current_value, 0, v_ent.plan_slug;
    return;
  end if;

  if v_ent.limit_value is null then
    return query select true, null::integer, p_current_value, null::integer, v_ent.plan_slug;
    return;
  end if;

  return query
  select
    (p_current_value < v_ent.limit_value),
    v_ent.limit_value,
    p_current_value,
    greatest(v_ent.limit_value - p_current_value, 0),
    v_ent.plan_slug;
end;
$$;

revoke execute on function public.check_entitlement_limit(uuid, text, integer) from public, anon;
grant execute on function public.check_entitlement_limit(uuid, text, integer) to authenticated;

comment on function public.check_entitlement_limit(uuid, text, integer) is
  'Etapa 15.8 — avalia um valor atual (fornecido pelo chamador) contra o limite do plano efetivo. limit_value NULL (ilimitado) sempre retorna allowed=true, remaining=NULL. Feature desabilitada sempre retorna allowed=false, remaining=0. Não implementa bloqueio em nenhum fluxo existente — só a função de consulta.';
