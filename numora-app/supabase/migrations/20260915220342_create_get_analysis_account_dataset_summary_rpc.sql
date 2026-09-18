-- ============================================================================
-- Etapa "5.10W.4 — Conta de Análise: Painel Administrativo" — RPC de
-- LEITURA para os indicadores de dataset (Itens/Países/Compras) exibidos
-- na UI administrativa.
--
-- POR QUE UMA RPC NOVA (justificada, "salvo se absolutamente necessária"):
-- auditado antes de escrever este arquivo — `collection_items`/`purchases`
-- só têm policies de RLS por ownership (`auth.uid() = user_id`), SEM
-- nenhuma policy de leitura administrativa (diferente de `profiles`/
-- `benefit_grants`/`internal_test_accounts`, que já têm `_select_admin`)
-- — um `.select()` direto do client, mesmo como owner/admin, devolveria 0
-- linhas silenciosamente para o dataset de OUTRO usuário (a Conta de
-- Análise). Sem esta RPC, a UI mostraria "0 itens" mesmo com 35 itens
-- reais — um bug de leitura, não um problema de segurança, mas real o
-- suficiente para justificar esta function mínima e somente-leitura.
--
-- Somente LEITURA (nenhum INSERT/UPDATE/DELETE) — nunca duplica as regras
-- de escrita já existentes em populate/reset_analysis_account_dataset().
-- Autorização: `is_platform_admin()` (owner OU admin, mesmo padrão de
-- `internal_test_accounts_select_admin`) — mais permissiva que as RPCs de
-- escrita (owner-only) de propósito, exatamente como pedido ("Admin comum
-- pode ter acesso de leitura").
-- ============================================================================

create or replace function public.get_analysis_account_dataset_summary(p_user_id uuid)
returns table (item_count integer, country_count integer, purchase_count integer)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Não autorizado a consultar o dataset da Conta de Análise.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.internal_test_accounts where user_id = p_user_id) then
    raise exception 'O user_id informado não é uma Conta de Análise (internal_test_accounts).' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.collection_items ci where ci.user_id = p_user_id)::integer,
    (select count(distinct ci.country_code) from public.collection_items ci where ci.user_id = p_user_id and ci.country_code is not null)::integer,
    (select count(*) from public.purchases p where p.user_id = p_user_id)::integer;
end;
$$;

revoke execute on function public.get_analysis_account_dataset_summary(uuid) from public, anon;
grant execute on function public.get_analysis_account_dataset_summary(uuid) to authenticated;

comment on function public.get_analysis_account_dataset_summary(uuid) is
  'Etapa "5.10W.4 — Conta de Análise" — leitura agregada (itens/países/compras) do dataset de uma Conta de Análise, contornando a ausência de policy de leitura administrativa em collection_items/purchases (só ownership). Somente leitura; admin ou owner (mais permissiva que as RPCs de escrita, de propósito). Revalida internal_test_accounts internamente.';
