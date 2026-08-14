-- ============================================================================
-- Fase 1, Etapa 8.1 — `collection_units`: o exemplar físico individual de
-- uma moeda catalogada em `collection_items`. Um `collection_item`
-- continua identificando a EMISSÃO (país, ano, denominação, metal...);
-- cada `collection_unit` identifica UM exemplar físico específico que o
-- colecionador possui — com sua própria conservação (`grade_id`), status
-- e avaliação pessoal (`rating`). `collection_items.quantity` deixa de
-- ser um número solto e passa a ser um espelho de `COUNT(collection_units)`,
-- mantido pelos triggers `sync_quantity_after_unit_*` abaixo — nunca mais
-- escrito diretamente pela aplicação.
--
-- Reconstruída nesta auditoria (Etapa 10) a partir do estado real do
-- banco — arquivo original nunca foi commitado no repositório. Todos os
-- objetos abaixo (tabela, constraints, índices, triggers, funções, RLS)
-- foram verificados via information_schema/pg_constraint/pg_indexes/
-- pg_trigger/pg_get_functiondef/pg_policies contra o schema hoje
-- existente. A coluna `is_primary` NÃO está aqui — ela só existe desde
-- `20260814164256_add_is_primary_to_collection_units.sql` (Etapa 10);
-- esta reconstrução reflete o estado de `collection_units` como ele
-- existia ANTES dessa migration posterior, sem is_primary/sem o índice
-- `collection_units_one_primary_per_item`/sem o trigger
-- `promote_primary_after_unit_delete`.
-- ============================================================================

create table public.collection_units (
  id                  uuid primary key default gen_random_uuid(),
  collection_item_id  uuid not null references public.collection_items (id) on delete cascade,
  grade_id            uuid references public.grades (id) on delete restrict,
  status              text not null default 'in_collection'
                        check (status in ('in_collection', 'for_trade', 'for_sale', 'reserved', 'sold', 'traded')),
  rating              smallint check (rating is null or (rating >= 1 and rating <= 5)),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_collection_units_item on public.collection_units (collection_item_id);
create index idx_collection_units_grade_id on public.collection_units (grade_id);
create index idx_collection_units_item_status on public.collection_units (collection_item_id, status);
-- Parcial: a maioria dos exemplares fica em 'in_collection' (default) — só
-- vale indexar quem está em algum status "ativo" (troca/venda/reservado).
create index idx_collection_units_status on public.collection_units (status) where status <> 'in_collection';

alter table public.collection_units enable row level security;

create policy "collection_units_select_own"
  on public.collection_units
  for select
  using (exists (
    select 1 from public.collection_items c
    where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
  ));

create policy "collection_units_insert_own"
  on public.collection_units
  for insert
  with check (exists (
    select 1 from public.collection_items c
    where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
  ));

create policy "collection_units_update_own"
  on public.collection_units
  for update
  using (exists (
    select 1 from public.collection_items c
    where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.collection_items c
    where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
  ));

create policy "collection_units_delete_own"
  on public.collection_units
  for delete
  using (exists (
    select 1 from public.collection_items c
    where c.id = collection_units.collection_item_id and c.user_id = (select auth.uid())
  ));

-- Reaproveita a função já criada na Etapa 2 — nenhuma função nova para updated_at.
create trigger set_collection_units_updated_at
  before update on public.collection_units
  for each row
  execute function public.set_updated_at();

-- Mantém `collection_items.quantity` sempre igual a COUNT(collection_units)
-- do item — dispara em qualquer insert/delete de exemplar. `security
-- definer` porque o usuário só tem UPDATE de `collection_units` via RLS,
-- não de `collection_items` diretamente por este caminho (a policy de
-- update de collection_items existe, mas este trigger evita depender
-- dela: quantity é um campo mantido pelo sistema, não pelo usuário).
create or replace function public.sync_collection_item_quantity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item_id uuid := coalesce(new.collection_item_id, old.collection_item_id);
begin
  update public.collection_items
  set quantity = (select count(*) from public.collection_units where collection_item_id = v_item_id)
  where id = v_item_id;
  return null;
end;
$$;

create trigger sync_quantity_after_unit_insert
  after insert on public.collection_units
  for each row
  execute function public.sync_collection_item_quantity();

create trigger sync_quantity_after_unit_delete
  after delete on public.collection_units
  for each row
  execute function public.sync_collection_item_quantity();

-- Um `collection_item` nunca pode ficar com 0 exemplares por aqui — para
-- "excluir a moeda inteira" o caminho é `DELETE collection_items`
-- (cascateia os units), nunca esvaziar os units de um item que continua
-- existindo. Erro customizado (P0001) com mensagem amigável, capturado
-- pela camada de repository da aplicação.
create or replace function public.check_collection_unit_not_last()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.collection_items where id = old.collection_item_id) then
    return old;
  end if;

  select count(*) into v_count
  from public.collection_units
  where collection_item_id = old.collection_item_id;

  if v_count <= 1 then
    raise exception 'Esta moeda possui apenas um exemplar. Para removê-la da coleção, use a opção Excluir moeda.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

create trigger prevent_last_unit_delete
  before delete on public.collection_units
  for each row
  execute function public.check_collection_unit_not_last();
