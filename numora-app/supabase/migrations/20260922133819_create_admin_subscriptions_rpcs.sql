-- ============================================================================
-- Etapa "Admin Subscriptions V1" — RPCs de LEITURA para o painel
-- administrativo de assinaturas (`/admin/subscriptions`).
--
-- FONTE DE DADOS (auditoria prévia, seção D): a tabela `public.subscriptions`
-- representa EXCLUSIVAMENTE assinaturas Stripe reais. Estas duas funções
-- NUNCA leem `benefit_grants` (cortesia/beta/partnership/admin/
-- internal_test) nem `internal_test_accounts` (Conta de Análise) — essas
-- duas coisas já têm suas próprias telas (`/admin/members`,
-- `/admin/analysis-account`) e não devem ser confundidas com uma assinatura
-- Stripe. Nenhuma das duas funções chama `effective_plans()`/
-- `get_effective_plan()` — o plano mostrado aqui é sempre o da SUBSCRIPTION
-- (`subscriptions.plan_id`), nunca o "plano efetivo" (que pode divergir se
-- houver uma cortesia sobrepondo).
--
-- `billing_webhook_events` (ledger de idempotência de webhook) também nunca
-- é lido aqui — é infraestrutura interna, não um dado de negócio a exibir.
--
-- SEGURANÇA (revisão explícita, não só cópia da aparência de
-- `admin_list_members()`):
--   - `security definer`: necessário porque a consulta cruza `profiles`
--     (nome/e-mail de QUALQUER usuário) + `subscriptions`/`billing_customers`/
--     `billing_transactions` de qualquer usuário — a RLS de ownership dessas
--     tabelas bloquearia isso para o chamador; a autorização REAL não é a
--     RLS (que o DEFINER bypassa), é a checagem explícita de
--     `is_platform_admin()` no topo de cada função, idêntica ao padrão já
--     usado por `admin_list_members()`/`switch_analysis_account_plan()`.
--   - `set search_path = ''` (mais estrito que o `set search_path = public`
--     já usado no resto do projeto, por pedido explícito desta etapa):
--     TODA referência a tabela/função é schema-qualificada
--     (`public.subscriptions`, `public.is_platform_admin()`, etc.) — nada
--     depende do search_path para resolver. `pg_catalog` (now(), count(),
--     operadores, tipos built-in) continua sempre pesquisado pelo Postgres
--     independentemente do search_path, então nenhuma função embutida
--     precisa de qualificação. Isto elimina até a POSSIBILIDADE teórica de
--     um "search_path hijack" (um objeto malicioso em outro schema do path
--     sendo resolvido no lugar do `public.*` pretendido) — risco que, neste
--     banco, já era zero na prática (confirmado por
--     `has_schema_privilege('public'|'authenticated'|'anon', 'public',
--     'CREATE')` = false, ou seja, nenhum papel não-owner pode sequer criar
--     um objeto em `public` para tentar isso), mas a garantia explícita no
--     código da função não deve depender de uma configuração externa do
--     banco que poderia mudar no futuro.
--   - Sem SQL dinâmico (`execute`/`format`) em nenhuma das duas.
--   - Sem nenhum INSERT/UPDATE/DELETE — puramente `select`, `language
--     plpgsql stable`.
--   - Nenhum parâmetro aceita bypass de autorização (não existe parâmetro
--     "as_user"/"skip_check" — a única forma de chamar é como o próprio
--     admin autenticado).
--   - `revoke execute ... from public, anon` + `grant execute ... to
--     authenticated` — a authenticated só passa da checagem de
--     `is_platform_admin()` se realmente for admin/owner.
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
    pp.currency,
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
  'Admin Subscriptions V1 — lista paginada/filtrada de assinaturas Stripe REAIS (public.subscriptions), nunca benefit_grants/internal_test/Conta de Análise. Somente admin/owner (is_platform_admin()). search_path vazio, tudo schema-qualificado. Somente leitura, limite 200/página.';

-- ----------------------------------------------------------------------------
-- admin_subscriptions_summary() — KPIs globais do topo da tela, INDEPENDENTES
-- dos filtros da tabela (mesmo espírito de admin_dashboard_metrics()).
--
-- Definições (documentadas aqui e nos testes):
--   total_subscriptions      = count(*) de public.subscriptions (todas).
--   active_subscriptions     = status = 'active'.
--   canceling_subscriptions  = cancel_at_period_end = true (independente do
--                               status atual).
--   failed_payment_subscriptions = assinaturas cuja billing_transaction MAIS
--                               RECENTE (por created_at) tem status='failed'
--                               — nunca "teve alguma falha alguma vez"; uma
--                               falha antiga já superada por um pagamento
--                               posterior bem-sucedido não conta.
-- ============================================================================

create or replace function public.admin_subscriptions_summary()
returns table (
  total_subscriptions bigint,
  active_subscriptions bigint,
  canceling_subscriptions bigint,
  failed_payment_subscriptions bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas administradores podem consultar o resumo de assinaturas.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.subscriptions) as total_subscriptions,
    (select count(*) from public.subscriptions s where s.status = 'active') as active_subscriptions,
    (select count(*) from public.subscriptions s where s.cancel_at_period_end) as canceling_subscriptions,
    (
      select count(*)
      from public.subscriptions s
      cross join lateral (
        select bt.status
        from public.billing_transactions bt
        where bt.subscription_id = s.id
        order by bt.created_at desc
        limit 1
      ) lt
      where lt.status = 'failed'
    ) as failed_payment_subscriptions;
end;
$$;

revoke execute on function public.admin_subscriptions_summary() from public, anon;
grant execute on function public.admin_subscriptions_summary() to authenticated;

comment on function public.admin_subscriptions_summary() is
  'Admin Subscriptions V1 — KPIs globais (total/ativas/cancelando/última transação falha), independentes dos filtros da tabela. Somente admin/owner. Ver comentário da migration para as definições exatas de cada contagem.';
