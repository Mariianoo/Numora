-- ============================================================================
-- Etapa "F4 — Numora Labels" — `ensure_label_codes()`, o ÚNICO caminho de
-- escrita de `collection_items.label_code`, e a barreira REAL de
-- autorização Pro+ (a UI é só UX — ver comentário do arquivo de migration
-- anterior). Mesmo padrão de `log_admin_action`/`delete_own_account_data`/
-- `set_collection_item_composition`: uma única RPC SECURITY DEFINER para
-- toda a operação sensível, nunca múltiplos caminhos.
--
-- Fail-closed: reaproveita `get_entitlement()` (Etapa 15.8) diretamente —
-- nenhuma lógica de plano reimplementada aqui. `enabled=false` (inclusive
-- por ausência de linha de entitlement) sempre nega.
--
-- "Não permitir cenário parcial" (decisão explícita do owner): a
-- verificação de ownership/existência/soft-delete roda para TODOS os
-- `p_item_ids` ANTES de qualquer UPDATE — um único item inválido no lote
-- aborta a chamada inteira (nenhum código é atribuído a ninguém), nunca um
-- resultado "alguns sim, alguns não" silencioso.
--
-- Idempotente: chamadas repetidas com os mesmos ids retornam sempre os
-- mesmos `label_code` (`where label_code is null` no UPDATE — um item que
-- já tem código nunca é tocado de novo; o `select` final devolve o código
-- de TODOS os ids pedidos, novos ou preexistentes).
--
-- Erro único (42501) tanto para "não pertence ao usuário" quanto para
-- "não existe"/"está na lixeira" — mesma filosofia de nunca diferenciar
-- motivos já usada por `get_public_passport` (não revela ao chamador qual
-- dos três casos ocorreu).
-- ============================================================================

create or replace function public.ensure_label_codes(p_item_ids uuid[])
returns table (item_id uuid, label_code text)
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  if not (select e.enabled from public.get_entitlement((select auth.uid()), 'labels') e) then
    raise exception 'Numora Labels é exclusivo dos planos Pro e superiores.' using errcode = '42501';
  end if;

  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as requested(id)
    left join public.collection_items ci
      on ci.id = requested.id
      and ci.user_id = (select auth.uid())
      and ci.deleted_at is null
    where ci.id is null
  ) then
    raise exception 'Um ou mais itens não pertencem ao usuário ou não estão disponíveis.' using errcode = '42501';
  end if;

  -- `collection_items.label_code` qualificado explicitamente: sem isso,
  -- o Postgres confunde a coluna com o parâmetro OUT `label_code` desta
  -- própria função (RETURNS TABLE), e a chamada falha com "column
  -- reference is ambiguous" (42702) — achado real em teste de integração
  -- antes do commit.
  update public.collection_items
  set label_code = 'NMR-' || lpad(nextval('public.label_code_seq')::text, 7, '0')
  where collection_items.id = any(p_item_ids)
    and collection_items.label_code is null;

  return query
  select ci.id, ci.label_code
  from public.collection_items ci
  where ci.id = any(p_item_ids);
end;
$$;

revoke execute on function public.ensure_label_codes(uuid[]) from public, anon;
grant execute on function public.ensure_label_codes(uuid[]) to authenticated;

comment on function public.ensure_label_codes(uuid[]) is
  'Etapa "F4 — Numora Labels" — único caminho para atribuir/ler label_code. Fail-closed via get_entitlement(auth.uid(), ''labels''); valida ownership+soft-delete de TODOS os ids antes de qualquer UPDATE (sem cenário parcial); idempotente (nunca sobrescreve um label_code já atribuído).';
