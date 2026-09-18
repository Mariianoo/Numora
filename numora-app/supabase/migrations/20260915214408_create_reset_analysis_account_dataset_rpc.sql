-- ============================================================================
-- Etapa "5.10W.3 — Conta de Análise: dataset fictício" — RPC de reset.
-- Escrita ANTES da RPC de população de propósito: populate chama reset
-- implicitamente (via a mesma checagem de "já populado"), então a lógica
-- de exclusão precisa existir primeiro.
--
-- MAPEAMENTO DE TABELAS RELACIONADAS (auditado via information_schema
-- antes de escrever este arquivo — nenhuma suposição):
--   collection_items (user_id, FK direta)
--     ON DELETE CASCADE -> collection_units
--       ON DELETE CASCADE -> coin_images
--     ON DELETE CASCADE -> collection_item_coin_parts
--       ON DELETE CASCADE -> collection_item_coin_part_components
--     ON DELETE CASCADE -> sales
--   purchases (user_id, FK direta a profiles — NUNCA referenciada a partir
--     de collection_items/collection_units com CASCADE; ambas usam
--     ON DELETE SET NULL) — por isso precisa de um DELETE explícito
--     separado, depois de collection_items (a ordem entre os dois DELETEs
--     não importa de fato, já que a FK é SET NULL, não RESTRICT, mas
--     collection_items primeiro é mais intuitivo de ler).
--
-- Portanto: apagar `collection_items` sozinho já cascata TODA a coleção
-- (exemplares, fotos, composição, vendas) — exatamente o mesmo mecanismo
-- que qualquer exclusão real de item já usa, nunca um caminho paralelo.
-- `purchases` precisa de um DELETE explícito próprio, porque nada cascata
-- para ela.
--
-- NUNCA apaga: internal_test_accounts, benefit_grants, profiles, ou
-- qualquer dado de autenticação — o `user_id`/conta em si permanece
-- intocado, só o DATASET (coleção) é removido.
--
-- SECURITY DEFINER pelo mesmo motivo de switch_analysis_account_plan
-- (Etapa 5.10W.2): precisa ler internal_test_accounts e escrever em
-- tabelas de coleção de outro usuário (a Conta de Análise) numa única
-- chamada — como isso bypassa a RLS de ownership dessas tabelas, a
-- checagem explícita abaixo (is_platform_owner() + internal_test_accounts)
-- é a autorização REAL, nunca a RLS ambiente.
-- ============================================================================

create or replace function public.reset_analysis_account_dataset(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Somente o owner pode resetar o dataset da Conta de Análise.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.internal_test_accounts where user_id = p_user_id) then
    raise exception 'O user_id informado não é uma Conta de Análise (internal_test_accounts).' using errcode = '42501';
  end if;

  -- Cascata real (ver mapeamento acima) — remove collection_units,
  -- coin_images, collection_item_coin_parts/components e sales junto.
  delete from public.collection_items where user_id = p_user_id;

  -- Nada cascata para purchases (FK é SET NULL, não CASCADE) — DELETE
  -- explícito, escopado ao mesmo user_id, nunca a um parâmetro livre.
  delete from public.purchases where user_id = p_user_id;
end;
$$;

revoke execute on function public.reset_analysis_account_dataset(uuid) from public, anon;
grant execute on function public.reset_analysis_account_dataset(uuid) to authenticated;

comment on function public.reset_analysis_account_dataset(uuid) is
  'Etapa "5.10W.3 — Conta de Análise" — apaga SOMENTE o dataset de coleção (collection_items + cascata real + purchases) de uma Conta de Análise. Somente owner; revalida internal_test_accounts internamente, nunca confia só no gate de UI. Nunca apaga internal_test_accounts/benefit_grants/profiles/autenticação.';
