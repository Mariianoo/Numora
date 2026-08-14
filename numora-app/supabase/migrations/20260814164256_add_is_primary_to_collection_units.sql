-- ============================================================================
-- Etapa 10 — exemplar principal. Cada collection_item pode ter no máximo
-- UM collection_unit com is_primary = true — é o exemplar usado para
-- representar a moeda na Grid/Lista/Passport/futuras transações.
-- NÃO confundir com `rating` (avaliação pessoal, independente disto).
--
-- Registrada nesta auditoria de rastreabilidade a partir do texto
-- exatamente aplicado via `apply_migration` nesta mesma sessão — não é
-- uma reconstrução por engenharia reversa do schema (ao contrário das
-- 6 migrations anteriores a esta etapa), é o SQL original, literal.
-- ============================================================================

alter table public.collection_units
  add column is_primary boolean not null default false;

-- Backfill: para cada item já existente, promove o exemplar mais antigo
-- (created_at asc) a principal. Nenhum item com exemplares fica sem
-- principal após esta migration.
update public.collection_units cu
set is_primary = true
from (
  select distinct on (collection_item_id) id
  from public.collection_units
  order by collection_item_id, created_at asc
) oldest
where cu.id = oldest.id;

-- Proteção real (não apenas de aplicação): o Postgres recusa fisicamente
-- mais de um is_primary=true por collection_item_id.
create unique index collection_units_one_primary_per_item
  on public.collection_units (collection_item_id)
  where is_primary = true;

-- Se o exemplar excluído era o principal, promove automaticamente o mais
-- antigo dos exemplares restantes. Roda DEPOIS de prevent_last_unit_delete
-- (BEFORE DELETE) já ter garantido que sempre sobra >=1 irmão quando esta
-- trigger dispara — a promoção nunca fica sem candidato. Não precisa de
-- SECURITY DEFINER: a RLS de UPDATE em collection_units já permite ao
-- dono atualizar qualquer exemplar do próprio item, incluindo o irmão
-- promovido aqui.
--
-- NOTA (ver 20260814165326_fix_promote_primary_tiebreak.sql): esta versão
-- usa só `order by created_at asc`, que se mostrou não-determinístico
-- entre exemplares criados no mesmo lote (mesma transação = mesmo
-- created_at). Corrigido numa migration posterior — este arquivo reflete
-- fielmente o que foi aplicado NESTE momento, não a versão final.
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
      order by created_at asc
      limit 1
    );
  end if;
  return OLD;
end;
$$;

create trigger promote_primary_after_unit_delete
  after delete on public.collection_units
  for each row
  execute function public.promote_primary_after_unit_delete();

-- Troca atômica do principal: dois UPDATEs sequenciais dentro da mesma
-- invocação = mesma transação implícita do PostgREST (uma chamada RPC =
-- uma transação) — nunca 2 principais simultâneos nem 0 no meio do
-- caminho. SECURITY INVOKER (padrão, explícito aqui): roda com a sessão
-- do usuário chamador, então a RLS de collection_units/collection_items
-- continua valendo por dentro da função. A checagem explícita de
-- ownership abaixo é defesa em profundidade — mesmo que a RLS já barre o
-- SELECT de um exemplar alheio (retornando "não encontrado" antes de
-- chegar aqui), o erro explícito deixa a intenção auditável.
create or replace function public.set_primary_collection_unit(p_unit_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item_id uuid;
  v_owner uuid;
begin
  select cu.collection_item_id, ci.user_id
  into v_item_id, v_owner
  from public.collection_units cu
  join public.collection_items ci on ci.id = cu.collection_item_id
  where cu.id = p_unit_id;

  if v_item_id is null then
    raise exception 'Exemplar não encontrado.' using errcode = 'P0002';
  end if;

  if v_owner <> (select auth.uid()) then
    raise exception 'Você não tem permissão para alterar este exemplar.' using errcode = '42501';
  end if;

  update public.collection_units
  set is_primary = false
  where collection_item_id = v_item_id and is_primary = true and id <> p_unit_id;

  update public.collection_units
  set is_primary = true
  where id = p_unit_id;
end;
$$;

revoke all on function public.set_primary_collection_unit(uuid) from public;
grant execute on function public.set_primary_collection_unit(uuid) to authenticated;
