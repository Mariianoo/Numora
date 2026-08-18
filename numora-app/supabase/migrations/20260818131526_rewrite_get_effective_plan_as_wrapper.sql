-- ============================================================================
-- Etapa 15.9.1-R2 (Fonte Única de Plano Efetivo) — get_effective_plan()
-- passa a ser um wrapper fino sobre effective_plans(uuid) (migration
-- anterior). Contrato público 100% preservado: mesma assinatura
-- (p_user_id uuid), mesmas 6 colunas de retorno na mesma ordem/tipo, mesma
-- autorização self-or-admin, mesmo comportamento em todos os casos A–I já
-- validados na Etapa 15.7 (ver relatório de testes desta etapa).
--
-- `create or replace` em migration NOVA — a migration original
-- (20260817110700_create_effective_plan.sql) nunca foi editada, só
-- superada, mesmo padrão já usado em fix_subscription_plan_required
-- (Etapa 15.7-R1) e restrict_commercial_config_to_owner (Etapa 15.8).
-- ============================================================================

create or replace function public.get_effective_plan(p_user_id uuid)
returns table (
  plan_slug text,
  plan_id uuid,
  source text,
  subscription_status text,
  courtesy_type text,
  courtesy_expires_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_user_id <> (select auth.uid()) and not public.is_platform_admin() then
    raise exception 'Não autorizado a consultar o plano efetivo de outro usuário.' using errcode = '42501';
  end if;

  return query
  select ep.plan_slug, ep.plan_id, ep.source, ep.subscription_status, ep.courtesy_type, ep.courtesy_expires_at
  from public.effective_plans(p_user_id) ep;
end;
$$;

revoke execute on function public.get_effective_plan(uuid) from public, anon;
grant execute on function public.get_effective_plan(uuid) to authenticated;

comment on function public.get_effective_plan(uuid) is
  'Etapa 15.9.1-R2 — wrapper fino sobre effective_plans(uuid), a única fonte da prioridade courtesy > subscription > free (antes: implementação própria duplicada, Etapa 15.7). Contrato público inalterado. Usuário só consulta a própria linha, salvo admin/owner.';
