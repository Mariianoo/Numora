-- ============================================================================
-- Etapa 15.9.1-R2 (Fonte Única de Plano Efetivo) — RPC agregada para o
-- Owner Center: distribuição de membros por plano efetivo (free/pro/
-- premium), OWNER-only.
--
-- `language plpgsql` (diferente de effective_plans(), que é `language
-- sql`): esta função precisa do `if not is_platform_owner() then raise
-- exception` — mesmo padrão de TODA RPC administrativa existente
-- (admin_dashboard_metrics, admin_list_members, get_entitlement) usa
-- plpgsql exatamente por causa desse gate procedural. `effective_plans()`
-- continua sendo a única fonte set-based — esta função só agrega o
-- resultado dela com GROUP BY, nunca reimplementa a prioridade.
--
-- OWNER-only via is_platform_owner() (Etapa 15.7, reutilizada sem
-- alteração) — não is_platform_admin(): distribuição de plano é dado
-- comercial, mesma régua já usada para plans/plan_prices/plan_entitlements
-- (Etapa 15.8) e benefit_grants (Etapa 15.8-R3). Nenhuma segunda definição
-- de OWNER foi criada.
--
-- Só retorna planos com >= 1 membro (mesmo critério de
-- computeStatusDistribution/computeSubscriptionStatusDistribution — nunca
-- inventa uma linha com contagem 0); o zero-preenchimento visual dos 3
-- planos do catálogo (Free/Pro/Premium mesmo com 0) continua sendo
-- responsabilidade da camada de apresentação (app/admin/page.tsx já busca
-- `plans` separadamente para o card "Planos ativos" — reaproveitado para
-- este zero-fill, sem query adicional).
-- ============================================================================

create or replace function public.admin_plan_distribution()
returns table (
  plan_slug text,
  member_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Apenas o OWNER pode consultar a distribuição de planos.' using errcode = '42501';
  end if;

  return query
  select ep.plan_slug, count(*) as member_count
  from public.effective_plans() ep
  group by ep.plan_slug;
end;
$$;

revoke execute on function public.admin_plan_distribution() from public, anon;
grant execute on function public.admin_plan_distribution() to authenticated;

comment on function public.admin_plan_distribution() is
  'Etapa 15.9.1-R2 — distribuição de membros por plano efetivo (free/pro/premium), agregada em 1 única query sobre effective_plans() (sem loop, sem N+1). OWNER-only via is_platform_owner(). Só retorna planos com >= 1 membro; zero-fill do catálogo é responsabilidade do chamador.';
