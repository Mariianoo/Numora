-- ============================================================================
-- Etapa "Stripe 5.6 — Customer Portal / Gestão da Assinatura":
--
-- 1) `subscriptions.scheduled_plan_id`/`stripe_schedule_id` — rastreiam um
--    downgrade agendado (Stripe Subscription Schedule) SEM inventar uma
--    tabela nova. Escritos pela aplicação (change-plan, downgrade) e
--    SEMPRE sobrescritos a cada sincronização (`sync_subscription_from_stripe`)
--    com o que o Stripe disser agora — auto-curativo: quando o Schedule
--    conclui a transição de fase e o Stripe libera a subscription
--    (`schedule = null`), a próxima sincronização automaticamente limpa
--    os dois campos para `null`. O Stripe continua sendo a única fonte de
--    verdade do timing — nunca um cron/flag/reconciliação manual do Numora.
--
-- 2) `sync_subscription_from_stripe` ganha 2 parâmetros novos
--    (`p_stripe_schedule_id`, `p_scheduled_plan_id`) para gravar o que foi
--    descrito acima. Precisa de DROP + CREATE (não apenas CREATE OR REPLACE)
--    porque a lista de parâmetros muda — `CREATE OR REPLACE` com uma lista
--    de parâmetros diferente criaria uma segunda função (overload) em vez
--    de substituir a existente.
--
-- 3) `get_my_subscription()` — RPC self-scoped nova (mesmo padrão de
--    `get_effective_plan`/`get_my_entitlement`): devolve só os dados da
--    PRÓPRIA subscription do usuário autenticado (via `auth.uid()`, nunca
--    um parâmetro de usuário) — nunca acesso genérico a `subscriptions`.
--    Prioriza a subscription em estado elegível (Stripe 5.1) quando existe
--    (no máximo 1, pela própria constraint `uq_subscriptions_user_id_active_status`);
--    cai para a mais recente de qualquer status quando não há nenhuma
--    elegível (ex.: `canceled`); retorna 0 linhas para "nunca teve
--    subscription" (Free, sem nunca ter assinado). Nunca retorna
--    `stripe_subscription_id`/`stripe_customer_id` — o frontend nunca
--    precisa desses IDs (todas as ações passam pelas rotas do Numora, que
--    resolvem tudo server-side a partir de `auth.uid()`).
-- ============================================================================

alter table public.subscriptions
  add column scheduled_plan_id uuid references public.plans (id) on delete set null,
  add column stripe_schedule_id text;

comment on column public.subscriptions.scheduled_plan_id is
  'Etapa "Stripe 5.6" — plano para o qual um downgrade está agendado via Stripe Subscription Schedule (null = nenhum downgrade agendado). Sempre sobrescrito pela sincronização canônica — nunca uma flag manual.';
comment on column public.subscriptions.stripe_schedule_id is
  'Etapa "Stripe 5.6" — Subscription Schedule Stripe ativo para esta subscription, se houver (null = nenhum). Mesma garantia de auto-cura de scheduled_plan_id.';

drop function if exists public.sync_subscription_from_stripe(
  uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, text
);

create function public.sync_subscription_from_stripe(
  p_user_id uuid,
  p_billing_customer_id uuid,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_plan_id uuid,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_trial_end timestamptz,
  p_stripe_event_id text,
  p_source text default 'webhook',
  p_stripe_schedule_id text default null,
  p_scheduled_plan_id uuid default null
)
returns table (
  subscription_id uuid,
  previous_status text,
  new_status text,
  transition_recorded boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_subscription_id uuid;
  v_previous_status text;
  v_transition_recorded boolean := false;
begin
  select s.id, s.status into v_subscription_id, v_previous_status
  from public.subscriptions s
  where s.stripe_subscription_id = p_stripe_subscription_id
  for update;

  if v_subscription_id is null then
    insert into public.subscriptions (
      user_id, billing_customer_id, stripe_subscription_id, stripe_price_id, plan_id, status,
      current_period_start, current_period_end, cancel_at_period_end, canceled_at, trial_end,
      stripe_schedule_id, scheduled_plan_id
    ) values (
      p_user_id, p_billing_customer_id, p_stripe_subscription_id, p_stripe_price_id, p_plan_id, p_status,
      p_current_period_start, p_current_period_end, p_cancel_at_period_end, p_canceled_at, p_trial_end,
      p_stripe_schedule_id, p_scheduled_plan_id
    )
    returning id into v_subscription_id;
  else
    update public.subscriptions set
      user_id = p_user_id,
      billing_customer_id = p_billing_customer_id,
      stripe_price_id = p_stripe_price_id,
      plan_id = p_plan_id,
      status = p_status,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = p_cancel_at_period_end,
      canceled_at = p_canceled_at,
      trial_end = p_trial_end,
      stripe_schedule_id = p_stripe_schedule_id,
      scheduled_plan_id = p_scheduled_plan_id
    where id = v_subscription_id;
  end if;

  if v_previous_status is distinct from p_status then
    insert into public.subscription_events (subscription_id, from_status, to_status, source, stripe_event_id, metadata)
    values (v_subscription_id, v_previous_status, p_status, p_source, p_stripe_event_id, jsonb_build_object('synced_at', now()));
    v_transition_recorded := true;
  end if;

  return query select v_subscription_id, v_previous_status, p_status, v_transition_recorded;
end;
$$;

comment on function public.sync_subscription_from_stripe is
  'Etapa "Stripe 5.4B/5.6" — UPSERT atômico de subscriptions (por stripe_subscription_id) + registro condicional da transição em subscription_events + rastreio de Subscription Schedule (scheduled_plan_id/stripe_schedule_id, auto-curativo). Nunca resolve Customer/Price/Plan sozinha — recebe tudo já validado pela aplicação. server-only (service_role).';

revoke all on function public.sync_subscription_from_stripe(
  uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.sync_subscription_from_stripe(
  uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, text, text, uuid
) to service_role;

create function public.get_my_subscription()
returns table (
  subscription_id uuid,
  plan_slug text,
  plan_name text,
  status text,
  "interval" text,
  currency text,
  amount numeric,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  canceled_at timestamptz,
  trial_end timestamptz,
  scheduled_plan_slug text,
  scheduled_plan_name text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.id as subscription_id,
    p.slug as plan_slug,
    p.name as plan_name,
    s.status,
    pp.interval as "interval",
    pp.currency,
    pp.amount,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.canceled_at,
    s.trial_end,
    sp.slug as scheduled_plan_slug,
    sp.name as scheduled_plan_name
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  left join public.plan_prices pp on pp.stripe_price_id = s.stripe_price_id
  left join public.plans sp on sp.id = s.scheduled_plan_id
  where s.user_id = (select auth.uid())
  order by (s.status in ('trialing', 'active', 'past_due')) desc, s.created_at desc
  limit 1;
$$;

comment on function public.get_my_subscription is
  'Etapa "Stripe 5.6" — self-scoped (auth.uid()): devolve só a subscription do PRÓPRIO usuário autenticado (a elegível, se houver; senão a mais recente). Nunca aceita user_id por parâmetro, nunca expõe stripe_subscription_id/stripe_customer_id.';

revoke all on function public.get_my_subscription() from public, anon;
grant execute on function public.get_my_subscription() to authenticated;
