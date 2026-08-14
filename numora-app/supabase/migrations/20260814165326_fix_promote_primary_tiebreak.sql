-- ============================================================================
-- Etapa 10 — bug encontrado em teste real (navegador, dados reais): exemplares
-- criados em lote (`createMany`, mesma transação) têm created_at
-- IDÊNTICO — `ORDER BY created_at` sozinho não é determinístico entre
-- eles. Adiciona `id` como desempate estável em
-- `promote_primary_after_unit_delete()` (substitui a versão criada em
-- `20260814164256_add_is_primary_to_collection_units.sql`).
--
-- Registrada nesta auditoria de rastreabilidade a partir do texto
-- exatamente aplicado via `apply_migration` nesta mesma sessão.
-- ============================================================================

create or replace function public.promote_primary_after_unit_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if OLD.is_primary then
    update public.collection_units
    set is_primary = true
    where id = (
      select id from public.collection_units
      where collection_item_id = OLD.collection_item_id
      order by created_at asc, id asc
      limit 1
    );
  end if;
  return OLD;
end;
$$;
