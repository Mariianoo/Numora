-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — plano efetivo do usuário.
--
-- Única implementação da regra de prioridade (Etapa 15.7 §"EFFECTIVE
-- PLAN") — nenhum outro lugar do código deve reimplementar esta lógica:
--
--   PRIORIDADE 1 — benefit_grants ativo (não revogado, dentro da vigência,
--                  já iniciado): retorna o plano da cortesia, source =
--                  'courtesy'. Cortesia futura (starts_at > now()) NUNCA é
--                  considerada ativa.
--   PRIORIDADE 2 — subscriptions com status em ('trialing','active',
--                  'past_due'): retorna o plano da subscription, source =
--                  'subscription'.
--   PRIORIDADE 3 — nenhum dos dois acima: 'free', source = 'default'.
--
-- Cortesia sempre vence sobre subscription ativa (courtesy nunca é um
-- status de subscriptions — permanece exclusivamente em benefit_grants,
-- decisão reafirmada nesta etapa). `profiles.plan_tier` NUNCA é lido nem
-- escrito por esta function — continua existindo só por compatibilidade
-- (Etapa 15.7 §4), sem nenhum caminho automático de sincronização criado
-- aqui.
--
-- Autorização: um usuário só pode consultar o PRÓPRIO plano efetivo,
-- salvo se for admin/owner (is_platform_admin() já cobre ambos) — nunca
-- expõe se um terceiro é pagante para um usuário comum.
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
declare
  v_grant record;
  v_sub record;
begin
  if p_user_id <> (select auth.uid()) and not public.is_platform_admin() then
    raise exception 'Não autorizado a consultar o plano efetivo de outro usuário.' using errcode = '42501';
  end if;

  -- PRIORIDADE 1: cortesia ativa (mesma definição de "ativa" já usada em
  -- admin_dashboard_metrics/admin_list_members: não revogada, já iniciada,
  -- ainda não expirada).
  select bg.plan, bg.type, bg.expires_at
    into v_grant
  from public.benefit_grants bg
  where bg.user_id = p_user_id
    and bg.revoked_at is null
    and bg.starts_at <= now()
    and (bg.expires_at is null or bg.expires_at > now())
  order by bg.created_at desc
  limit 1;

  if found then
    return query
    select p.slug, p.id, 'courtesy'::text, null::text, v_grant.type, v_grant.expires_at
    from public.plans p
    where p.slug = v_grant.plan;
    return;
  end if;

  -- PRIORIDADE 2: subscription com acesso liberado.
  select s.plan_id, s.status
    into v_sub
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.status in ('trialing', 'active', 'past_due')
  order by s.created_at desc
  limit 1;

  if found then
    return query
    select p.slug, p.id, 'subscription'::text, v_sub.status, null::text, null::timestamptz
    from public.plans p
    where p.id = v_sub.plan_id;
    return;
  end if;

  -- PRIORIDADE 3: free (default).
  return query
  select p.slug, p.id, 'default'::text, null::text, null::text, null::timestamptz
  from public.plans p
  where p.slug = 'free';
end;
$$;

revoke execute on function public.get_effective_plan(uuid) from public, anon;
grant execute on function public.get_effective_plan(uuid) to authenticated;

comment on function public.get_effective_plan(uuid) is
  'Etapa 15.7 — única implementação da prioridade cortesia > subscription > free. Nunca lê/escreve profiles.plan_tier. Usuário só consulta a própria linha, salvo admin/owner.';
