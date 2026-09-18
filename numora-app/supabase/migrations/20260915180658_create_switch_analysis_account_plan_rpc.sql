-- ============================================================================
-- Etapa "5.10W.2 — Conta de Análise: plano simulado" — RPC transacional
-- que troca o plano simulado de uma Conta de Análise via
-- `benefit_grants.type = 'internal_test'`, nunca via Stripe/subscription.
--
-- `security definer` (mesmo padrão de `log_admin_action()`, Etapa 15.3):
-- necessária porque a função precisa ler `internal_test_accounts` e
-- escrever em `benefit_grants` num único statement atômico — como
-- `security definer` BYPASSA a RLS de ambas as tabelas internamente, a
-- ÚNICA autorização real passa a ser a checagem EXPLÍCITA abaixo
-- (`is_platform_owner()` + associação em `internal_test_accounts`), nunca
-- a RLS ambiente. `set search_path = public` fixo — mesmo padrão de toda
-- function security definer já existente no projeto (evita search_path
-- hijacking).
--
-- NUNCA aceita `p_user_id` arbitrário: revalida internamente que ele
-- pertence a `internal_test_accounts` — mesmo que a UI só ofereça esse
-- fluxo para a Conta de Análise, esta função nunca confia só nisso
-- (auditoria 5.10W, seção 14 — "possibilidade de alterar plano de usuário
-- real").
--
-- ATOMICIDADE: um único statement de chamada (`select
-- switch_analysis_account_plan(...)`) já é atômico por semântica do
-- Postgres — se qualquer `raise exception` disparar em qualquer ponto,
-- TUDO (o UPDATE de revogação e o INSERT do novo grant) é revertido.
-- Nenhum `begin`/`commit` explícito é necessário nem válido dentro de uma
-- function plpgsql chamada como statement único.
--
-- NUNCA cria `billing_customers`/`subscriptions`/`billing_transactions`,
-- nunca chama Stripe — a única tabela tocada é `benefit_grants`.
-- ============================================================================

create or replace function public.switch_analysis_account_plan(p_user_id uuid, p_plan text)
returns public.benefit_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.benefit_grants;
begin
  if not public.is_platform_owner() then
    raise exception 'Somente o owner pode alterar o plano da Conta de Análise.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.internal_test_accounts where user_id = p_user_id) then
    raise exception 'O user_id informado não é uma Conta de Análise (internal_test_accounts).' using errcode = '42501';
  end if;

  if p_plan not in ('free', 'pro', 'premium') then
    raise exception 'Plano inválido: %. Use free, pro ou premium.', p_plan using errcode = '22023';
  end if;

  -- Sempre revoga o grant internal_test ainda ativo desta conta ANTES de
  -- decidir o que fazer a seguir (roda também para p_plan = 'free') —
  -- garante que nunca existam 2 grants internal_test ativos ao mesmo
  -- tempo para a mesma conta.
  update public.benefit_grants
  set revoked_at = now()
  where user_id = p_user_id
    and type = 'internal_test'
    and revoked_at is null;

  if p_plan = 'free' then
    -- Solução mais simples compatível com effective_plans() (auditoria
    -- 5.10W): nenhum grant novo — free_candidates já garante 'free' como
    -- fallback quando não há courtesy/subscription ativa. Nunca se insere
    -- uma linha de benefit_grants para "cortesia de Free" (sem sentido
    -- semântico: Free já é o padrão de todo usuário).
    return null;
  end if;

  insert into public.benefit_grants (user_id, type, plan, reason, starts_at, expires_at)
  values (
    p_user_id,
    'internal_test',
    p_plan,
    'Conta de Análise — plano simulado (nunca uma cobrança real)',
    now(),
    null
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Nunca público/anon; `authenticated` recebe EXECUTE, mas a checagem
-- `is_platform_owner()` dentro da function é quem realmente barra
-- qualquer chamador que não seja owner — mesmo padrão de
-- `log_admin_action()`.
revoke execute on function public.switch_analysis_account_plan(uuid, text) from public, anon;
grant execute on function public.switch_analysis_account_plan(uuid, text) to authenticated;

comment on function public.switch_analysis_account_plan(uuid, text) is
  'Etapa "5.10W.2 — Conta de Análise" — troca o plano simulado (benefit_grants.type=internal_test) de uma Conta de Análise. Somente owner (is_platform_owner()); revalida internamente que p_user_id está em internal_test_accounts, nunca confia só no gate de UI. Nunca cria subscription/billing_customer/billing_transaction, nunca chama Stripe. Atômica por semântica de function call único.';
