-- ============================================================================
-- Etapa "Stripe 5.5 — Invoice & Payment Sync" — RPC mínima e bem
-- delimitada para tornar o upsert de UMA transação financeira
-- (`billing_transactions`, identidade por `stripe_invoice_id`) atômico e
-- seguro contra concorrência, seguindo exatamente o mesmo padrão já
-- aprovado em `sync_subscription_from_stripe` (Stripe 5.4B).
--
-- POR QUE UMA RPC: a regra de negócio "nunca deixar um invoice.payment_failed
-- tardio/fora de ordem rebaixar uma transação já paga" exige ler o status
-- atual e decidir atomicamente antes de escrever — inseguro fazer isso como
-- 2 chamadas PostgREST separadas (race entre 2 webhooks concorrentes para o
-- MESMO invoice, um "paid" e um "failed", chegando ao mesmo tempo).
--
-- ESCOPO DELIBERADAMENTE MÍNIMO: esta função NUNCA resolve Customer/
-- usuário/subscription sozinha — recebe tudo já resolvido e validado pela
-- camada de aplicação (lib/stripe/invoice-sync.ts). Só executa o upsert
-- atômico final.
--
-- IDENTIDADE: `stripe_invoice_id` (UNIQUE já existente desde a Etapa 15.7)
-- — create if missing, update if existing. Nunca duas linhas para o mesmo
-- invoice Stripe, não importa quantos eventos diferentes (`invoice.paid`,
-- `invoice.payment_failed`, retries de qualquer um dos dois) cheguem.
--
-- REGRA DE NÃO-REBAIXAMENTO: se a transação já existe com status='paid' e
-- o novo status pedido é 'failed', a função NÃO altera nada — devolve o
-- estado atual inalterado. Um pagamento já concluído nunca é desfeito por
-- uma notificação de falha atrasada/duplicada (isso não é um reembolso —
-- reembolsos estão fora do escopo desta etapa).
--
-- NUNCA apaga uma associação já resolvida: em updates, `subscription_id` e
-- `stripe_payment_intent_id` só são sobrescritos quando o novo valor não é
-- nulo (`coalesce`) — um evento posterior sem essas informações não deve
-- apagar o que um evento anterior já tinha resolvido corretamente.
-- ============================================================================

create or replace function public.sync_billing_transaction_from_invoice(
  p_user_id uuid,
  p_subscription_id uuid,
  p_stripe_invoice_id text,
  p_stripe_payment_intent_id text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_paid_at timestamptz
)
returns table (
  transaction_id uuid,
  previous_status text,
  new_status text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_previous_status text;
begin
  select bt.id, bt.status into v_id, v_previous_status
  from public.billing_transactions bt
  where bt.stripe_invoice_id = p_stripe_invoice_id
  for update;

  if v_id is null then
    insert into public.billing_transactions (
      user_id, subscription_id, stripe_invoice_id, stripe_payment_intent_id, amount, currency, status, paid_at
    ) values (
      p_user_id, p_subscription_id, p_stripe_invoice_id, p_stripe_payment_intent_id, p_amount, p_currency, p_status, p_paid_at
    )
    returning id into v_id;

    return query select v_id, null::text, p_status;
    return;
  end if;

  if v_previous_status = 'paid' and p_status = 'failed' then
    return query select v_id, v_previous_status, 'paid'::text;
    return;
  end if;

  update public.billing_transactions set
    user_id = p_user_id,
    subscription_id = coalesce(p_subscription_id, subscription_id),
    stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
    amount = p_amount,
    currency = p_currency,
    status = p_status,
    paid_at = p_paid_at
  where id = v_id;

  return query select v_id, v_previous_status, p_status;
end;
$$;

comment on function public.sync_billing_transaction_from_invoice is
  'Etapa "Stripe 5.5" — UPSERT atômico de billing_transactions por stripe_invoice_id. Nunca resolve Customer/user/subscription sozinha — recebe tudo já validado pela aplicação. Nunca deixa um payment_failed tardio rebaixar uma transação já paid. server-only (service_role).';

revoke all on function public.sync_billing_transaction_from_invoice(
  uuid, uuid, text, text, numeric, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.sync_billing_transaction_from_invoice(
  uuid, uuid, text, text, numeric, text, text, timestamptz
) to service_role;
