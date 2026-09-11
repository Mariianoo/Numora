-- ============================================================================
-- Etapa "5.10F — Account Deletion x Async Stripe Webhook Race Fix":
--
-- PROBLEMA (auditoria 5.10E/5.10F): cancelAllStripeSubscriptionsForAccountDeletion
-- (Etapa 5.7) cancela a subscription no Stripe de forma SÍNCRONA antes de
-- delete_own_account_data remover billing_customers/subscriptions localmente
-- (cascade). O cancelamento em si dispara, do lado do Stripe, um evento
-- ASSÍNCRONO customer.subscription.deleted — que chega ao webhook em
-- momento não-determinístico, às vezes minutos depois (observado: ~68min no
-- 5.10E), quando billing_customers já não existe mais. O handler do webhook
-- (resolveBillingCustomerByStripeCustomerId) então lança "customer não
-- encontrado" — correto para um Customer genuinamente desconhecido, mas
-- incorreto para este caso: o Customer EXISTIU, a conta só foi legitimamente
-- excluída depois.
--
-- SOLUÇÃO (5.10F Decision Report, Alternativa B — aprovada): um tombstone
-- leve, gravado ATOMICAMENTE dentro da mesma função/transação que remove os
-- dados locais, permite ao webhook distinguir "Customer nunca existiu aqui"
-- (fail-closed inalterado) de "Customer existiu, conta foi excluída depois"
-- (tratado como SkippedSyncResult, nunca sucesso silencioso indiscriminado —
-- só quando há PROVA POSITIVA e específica daquele stripe_customer_id).
--
-- Mesmo padrão de segurança de analytics_outbox/billing_webhook_events
-- (Etapas 5.9G/15.7): RLS habilitada + ZERO policies + REVOKE explícito =
-- negação total para authenticated/anon via PostgREST — só código
-- server-side com service_role (webhook handler, delete_own_account_data via
-- SECURITY DEFINER) toca esta tabela. Não é dado do usuário — é
-- telemetria/auditoria interna de que uma exclusão de conta aconteceu.
--
-- stripe_customer_id como PRIMARY KEY (não um id surrogate): a busca é
-- sempre por esse valor (é o que o webhook tem em mãos), e billing_customers
-- já garante 1:1 usuário↔Customer — nunca pode haver 2 tombstones para o
-- mesmo Customer.
-- ============================================================================

create table public.deleted_billing_customers (
  stripe_customer_id  text primary key,
  user_id             uuid not null,
  deleted_at          timestamptz not null default now()
);

comment on table public.deleted_billing_customers is
  'Etapa "5.10F — Account Deletion x Async Stripe Webhook Race Fix" — tombstone de Stripe Customers cuja conta local foi excluída (delete_own_account_data). Permite que um webhook assíncrono tardio referente ao cancelamento feito durante a exclusão (ex.: customer.subscription.deleted) seja resolvido como SkippedSyncResult em vez de falha — nunca usado para associar um Customer a outro usuário, nunca criado fora de delete_own_account_data. Sem NENHUMA policy para authenticated/anon — só acessível a código server-side com service_role.';

comment on column public.deleted_billing_customers.user_id is
  'Só para referência/auditoria — sem FK para profiles (a linha de profiles já foi removida quando este tombstone é gravado).';

alter table public.deleted_billing_customers enable row level security;

revoke all on public.deleted_billing_customers from authenticated, anon;

-- ----------------------------------------------------------------------------
-- Atualiza delete_own_account_data para gravar o tombstone (quando existir
-- um billing_customers.stripe_customer_id vinculado ao usuário) ANTES do
-- DELETE FROM profiles que dispara o cascade — mesma função/transação,
-- atômico por construção (nenhuma nova janela de corrida introduzida).
-- Preserva INTEGRALMENTE a checagem de owner já existente (Etapa 15.10.17B).
-- ----------------------------------------------------------------------------

create or replace function public.delete_own_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_role text;
  v_stripe_customer_id text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Não é permitido excluir dados de outro usuário.' using errcode = '42501';
  end if;

  select role into v_target_role from public.profiles where id = p_user_id;

  if v_target_role = 'owner' then
    raise exception 'A conta do proprietário da plataforma não pode ser excluída por este fluxo.' using errcode = '42501';
  end if;

  -- Etapa 5.10F — grava o tombstone SE este usuário tinha um Stripe
  -- Customer vinculado. Idempotente: numa chamada repetida, billing_customers
  -- já não existe mais (DELETE anterior já cascateou), então
  -- v_stripe_customer_id fica null e nada é regravado; on conflict do
  -- nothing também protege contra a PRIMARY KEY caso algum dia chegue a
  -- esse ponto de outra forma.
  select bc.stripe_customer_id into v_stripe_customer_id
  from public.billing_customers bc
  where bc.user_id = p_user_id;

  if v_stripe_customer_id is not null then
    insert into public.deleted_billing_customers (stripe_customer_id, user_id)
    values (v_stripe_customer_id, p_user_id)
    on conflict (stripe_customer_id) do nothing;
  end if;

  -- Idempotente: se p_user_id já não existir em profiles (chamada repetida,
  -- ou execução parcial anterior que já concluiu este passo), este DELETE
  -- afeta 0 linhas e retorna normalmente — nunca é um erro.
  delete from public.profiles where id = p_user_id;
end;
$$;

comment on function public.delete_own_account_data(uuid) is
  'Etapa 15.10.17A/B + 5.10F — remove profile + todo dado dependente (coleção, exemplares, fotos [metadados], compras, vendas, atribuição, assinaturas) via cascade do Postgres; bloqueia role=owner; grava um tombstone em deleted_billing_customers ANTES da remoção, se o usuário tinha um Stripe Customer vinculado (5.10F — resolve a corrida entre exclusão de conta e webhooks assíncronos tardios do Stripe). NÃO toca em auth.users nem em Storage. EXECUTE só para service_role — nunca chamável por um usuário comum via PostgREST.';
