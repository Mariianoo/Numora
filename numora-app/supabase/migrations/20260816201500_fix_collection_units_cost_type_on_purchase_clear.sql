-- ============================================================================
-- Etapa 14.3 — correção encontrada durante os testes reais desta mesma
-- etapa (Teste de limpeza de dados: apagar uma purchase aciona
-- `collection_units_purchase_id_fkey ... ON DELETE SET NULL`, que gera um
-- UPDATE interno `SET purchase_id = NULL` — mas isso por si só deixa
-- `cost_type = 'purchase'` com `purchase_id IS NULL`, violando
-- `chk_collection_units_cost_type_purchase_id` adicionada há pouco na
-- mesma Migration 1). Sem esta correção, qualquer exclusão real de uma
-- `purchase` (hoje só possível via `PurchasesRepository.remove()`, ainda
-- sem UI, mas existente) quebraria com um erro de constraint.
--
-- Fix: trigger BEFORE UPDATE que roda ANTES da CHECK ser avaliada — quando
-- o UPDATE gerado pelo ON DELETE SET NULL zera purchase_id, este trigger
-- também rebaixa cost_type para 'unknown' na mesma linha, mantendo a
-- invariante sempre válida. unit_cost NÃO é apagado (o valor histórico
-- continua registrado — só o discriminador de origem muda, porque a
-- origem "purchase" deixou de ser rastreável).
-- ============================================================================
create or replace function public.sync_collection_unit_cost_type_on_purchase_clear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_id is null and new.cost_type = 'purchase' then
    new.cost_type := 'unknown';
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_collection_unit_cost_type_on_purchase_clear() from public, anon, authenticated;

create trigger sync_cost_type_on_purchase_clear
  before update on public.collection_units
  for each row
  execute function public.sync_collection_unit_cost_type_on_purchase_clear();
