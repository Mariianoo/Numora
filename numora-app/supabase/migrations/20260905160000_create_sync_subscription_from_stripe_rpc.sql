-- ============================================================================
-- Etapa "Stripe 5.4B — Subscription Sync" — RPC mínima e bem delimitada
-- para tornar a sincronização de UMA subscription (UPSERT em
-- `subscriptions` + registro condicional da transição em
-- `subscription_events`) atômica dentro de uma única transação do
-- Postgres.
--
-- POR QUE UMA RPC (e não 2-3 chamadas separadas via PostgREST):
-- para registrar a transição em `subscription_events` corretamente
-- (from_status/to_status), é preciso LER o status anterior, decidir se
-- houve mudança de verdade e só então gravar — 3 operações que, feitas
-- via chamadas HTTP separadas, deixariam uma janela onde uma falha entre
-- elas gravaria a subscription mas perderia o registro de auditoria da
-- transição (ou vice-versa). Uma função só resolve isso com a garantia
-- transacional nativa do Postgres, sem exigir nenhuma infraestrutura nova
-- (nenhuma tabela adicional, nenhum lock explícito).
--
-- ESCOPO DELIBERADAMENTE MÍNIMO: esta função NUNCA resolve
-- Customer/Price/Plan sozinha — recebe tudo já resolvido e validado pela
-- camada de aplicação (lib/stripe/subscription-sync.ts), que é quem decide
-- FALHAR explicitamente antes de chamar esta RPC quando o Customer/Price
-- não tiverem correspondência local. Esta função só executa a escrita
-- atômica final.
--
-- IDEMPOTÊNCIA: identidade da subscription local é `stripe_subscription_id`
-- (UNIQUE já existente, Etapa 15.7/Stripe 3) — create if missing, update if
-- existing, nunca duas linhas para a mesma subscription Stripe.
--
-- TRANSIÇÃO: só grava em `subscription_events` quando o status
-- efetivamente muda dentro desta mesma chamada (`old_status IS DISTINCT
-- FROM p_status`) — nunca usa `stripe_event_id` como chave de dedup aqui
-- (subscription_events não é mecanismo de idempotência, é auditoria; a
-- idempotência real já é `billing_webhook_events.stripe_event_id UNIQUE`,
-- Stripe 5.4A — um evento genuinamente duplicado nunca chega a chamar esta
-- função de novo).
--
-- SEGURANÇA: as constraints/triggers já existentes em `subscriptions`
-- (uq_subscriptions_user_id_active_status — Stripe 5.1;
-- enforce_subscription_plan_matches_price;
-- enforce_subscription_user_matches_billing_customer; CHECK de status)
-- continuam disparando normalmente sobre o INSERT/UPDATE feito aqui dentro
-- — nenhuma delas é contornada. Uma violação real (ex.: 2ª subscription
-- elegível para o mesmo usuário) propaga como erro da chamada RPC — nunca
-- mascarada, nunca corrigida automaticamente.
-- ============================================================================

create or replace function public.sync_subscription_from_stripe(
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
  p_source text default 'webhook'
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
      current_period_start, current_period_end, cancel_at_period_end, canceled_at, trial_end
    ) values (
      p_user_id, p_billing_customer_id, p_stripe_subscription_id, p_stripe_price_id, p_plan_id, p_status,
      p_current_period_start, p_current_period_end, p_cancel_at_period_end, p_canceled_at, p_trial_end
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
      trial_end = p_trial_end
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
  'Etapa "Stripe 5.4B" — UPSERT atômico de subscriptions (por stripe_subscription_id) + registro condicional da transição em subscription_events. Nunca resolve Customer/Price/Plan sozinha — recebe tudo já validado pela aplicação. server-only (service_role).';

revoke all on function public.sync_subscription_from_stripe(
  uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, text
) from public, anon, authenticated;

grant execute on function public.sync_subscription_from_stripe(
  uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, text
) to service_role;
