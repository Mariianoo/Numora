-- ============================================================================
-- Etapa 15.9.1-R2 (Fonte Única de Plano Efetivo) — fonte set-based única da
-- regra comercial "qual plano efetivo este usuário possui?".
--
-- ACHADO (Etapa 15.9.1-R1): a prioridade courtesy > subscription > free
-- estava implementada em `get_effective_plan()` (por usuário, plpgsql) E
-- reimplementada em `computePlanDistribution()` (TypeScript, agregada) — 2
-- fontes de verdade divergentes na prática. Esta migration cria a ÚNICA
-- definição SQL set-based da regra; `get_effective_plan()` (próxima
-- migration) e `admin_plan_distribution()` passam a ser wrappers finos
-- sobre ela — nunca reimplementam a prioridade.
--
-- `language sql` (não plpgsql) de propósito: permite ao planner tratar o
-- corpo como uma única query otimizável, em vez de um loop procedural.
-- `p_user_id uuid default null`: quando informado, cada CTE filtra por
-- `user_id = p_user_id` ANTES do UNION/window function — uma consulta por
-- 1 usuário usa os mesmos índices (idx_benefit_grants_user,
-- idx_subscriptions_user_id, PK de profiles) que uma consulta direta
-- faria, sem nunca varrer a base inteira. Quando `null` (modo agregado,
-- usado por `admin_plan_distribution()`), roda 1 única vez sobre todos os
-- usuários — nunca em loop, nunca N chamadas.
--
-- Prioridade explícita e determinística via `priority` (1=courtesy,
-- 2=subscription, 3=free) + `row_number() over (partition by user_id
-- order by priority asc, created_at desc)`: reproduz exatamente o mesmo
-- desempate "mais recente vence" já usado em get_effective_plan() (Etapa
-- 15.7) para cortesias/subscriptions múltiplas do mesmo usuário — nenhuma
-- regra comercial nova, só a mesma regra expressa de forma set-based.
--
-- `free_candidates` tem 2 ramos deliberados: o primeiro cobre o caso
-- normal (1 linha por profile real, ou só a linha de `p_user_id` quando
-- filtrado); o segundo reproduz o comportamento (hoje inatingível, mas
-- preservado por completude/contrato) do `get_effective_plan()` original,
-- que SEMPRE retornava uma linha 'free' para PRIORIDADE 3
-- INCONDICIONALMENTE — mesmo para um `p_user_id` que não corresponda a
-- nenhuma linha em `profiles`. Sem o segundo ramo, um `p_user_id`
-- inexistente passaria a retornar 0 linhas em vez de 1 — mudança de
-- contrato não autorizada por esta etapa.
--
-- `security definer`: lê `benefit_grants`/`subscriptions`/`profiles` de
-- QUALQUER usuário, então precisa do mesmo bypass de RLS que
-- `get_effective_plan()` já tinha. Por isso é revogada de
-- public/anon/authenticated logo abaixo — só alcançável através dos
-- wrappers autorizados (get_effective_plan/admin_plan_distribution), que
-- executam com o mesmo papel de definer ao chamá-la internamente (mesmo
-- padrão já usado por get_entitlement() → get_effective_plan(), Etapa
-- 15.8).
-- ============================================================================

create or replace function public.effective_plans(p_user_id uuid default null)
returns table (
  user_id uuid,
  plan_slug text,
  plan_id uuid,
  source text,
  subscription_status text,
  courtesy_type text,
  courtesy_expires_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with courtesy_candidates as (
    select
      bg.user_id,
      p.slug as plan_slug,
      p.id as plan_id,
      'courtesy'::text as source,
      null::text as subscription_status,
      bg.type as courtesy_type,
      bg.expires_at as courtesy_expires_at,
      1 as priority,
      bg.created_at
    from public.benefit_grants bg
    join public.plans p on p.slug = bg.plan
    where bg.revoked_at is null
      and bg.starts_at <= now()
      and (bg.expires_at is null or bg.expires_at > now())
      and (p_user_id is null or bg.user_id = p_user_id)
  ),
  subscription_candidates as (
    select
      s.user_id,
      p.slug as plan_slug,
      p.id as plan_id,
      'subscription'::text as source,
      s.status as subscription_status,
      null::text as courtesy_type,
      null::timestamptz as courtesy_expires_at,
      2 as priority,
      s.created_at
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status in ('trialing', 'active', 'past_due')
      and (p_user_id is null or s.user_id = p_user_id)
  ),
  free_candidates as (
    select
      pr.id as user_id,
      'free'::text as plan_slug,
      (select fp.id from public.plans fp where fp.slug = 'free') as plan_id,
      'default'::text as source,
      null::text as subscription_status,
      null::text as courtesy_type,
      null::timestamptz as courtesy_expires_at,
      3 as priority,
      to_timestamp(0) as created_at
    from public.profiles pr
    where p_user_id is null or pr.id = p_user_id

    union all

    select
      p_user_id as user_id,
      'free'::text as plan_slug,
      (select fp.id from public.plans fp where fp.slug = 'free') as plan_id,
      'default'::text as source,
      null::text as subscription_status,
      null::text as courtesy_type,
      null::timestamptz as courtesy_expires_at,
      3 as priority,
      to_timestamp(0) as created_at
    where p_user_id is not null
      and not exists (select 1 from public.profiles pr2 where pr2.id = p_user_id)
  ),
  ranked as (
    select
      c.*,
      row_number() over (partition by c.user_id order by c.priority asc, c.created_at desc) as rn
    from (
      select * from courtesy_candidates
      union all
      select * from subscription_candidates
      union all
      select * from free_candidates
    ) c
  )
  select user_id, plan_slug, plan_id, source, subscription_status, courtesy_type, courtesy_expires_at
  from ranked
  where rn = 1;
$$;

revoke execute on function public.effective_plans(uuid) from public, anon, authenticated;

comment on function public.effective_plans(uuid) is
  'Etapa 15.9.1-R2 — ÚNICA definição set-based da prioridade courtesy > subscription > free. Nunca chamada diretamente por authenticated (revogada) — só através de get_effective_plan() (per-user) e admin_plan_distribution() (agregada, OWNER-only). p_user_id null = modo agregado (todos os usuários, 1 única query); p_user_id informado = filtrado internamente, mesmos índices de uma consulta direta.';
