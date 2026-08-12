-- ============================================================================
-- Fase 1, Etapa 5 — `sales`: registro de venda de um collection_item.
--
-- `collection_items` NÃO é alterada nesta etapa (decisão explícita —
-- Opção A da análise de ambiguidade desta etapa): sem `status`, sem
-- `deleted_at`, sem trigger nova nela. A invariante "não vender mais do
-- que se tem" é garantida inteiramente dentro de `sales`, lendo
-- `collection_items.quantity` (só leitura, nunca escreve nela).
-- ============================================================================

create table public.sales (
  id                  uuid primary key default gen_random_uuid(),
  collection_item_id  uuid not null references public.collection_items (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  quantity            integer not null default 1 check (quantity > 0),
  sale_price          numeric(12, 2) not null check (sale_price >= 0),
  currency            char(3) not null default 'BRL',
  sale_date           date,
  buyer_name          text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.sales is
  'Registro de venda de um collection_item. sale_price é o valor TOTAL dessa venda (não por unidade) — mesma convenção de purchases.total_price. A soma de quantity vendida por item nunca pode exceder collection_items.quantity (ver trigger enforce_sale_quantity); collection_items em si permanece sem alteração de schema nesta etapa.';

comment on column public.sales.quantity is
  'Quantas unidades deste collection_item foram vendidas NESTA venda (suporta venda parcial de um item com quantity > 1). Validado contra o saldo disponível pela trigger enforce_sale_quantity.';

alter table public.sales enable row level security;

create policy "sales_select_own"
  on public.sales
  for select
  using ((select auth.uid()) = user_id);

-- INSERT/UPDATE verificam, além da posse da própria linha, que
-- collection_item_id pertence ao mesmo usuário — mesma lógica já usada
-- para purchase_id em collection_items (Etapa 4): a RLS de `sales`
-- sozinha não enxerga a ownership de `collection_items`.
create policy "sales_insert_own"
  on public.sales
  for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  );

create policy "sales_update_own"
  on public.sales
  for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  );

create policy "sales_delete_own"
  on public.sales
  for delete
  using ((select auth.uid()) = user_id);

-- Índices: cobertura de FK + a query de soma que a trigger roda a cada
-- insert/update relevante (WHERE collection_item_id = ...); listagem
-- padrão "mais recentes primeiro", mesmo padrão de purchases.
create index idx_sales_collection_item on public.sales (collection_item_id);
create index idx_sales_user_date on public.sales (user_id, sale_date desc);

-- ----------------------------------------------------------------------------
-- Invariante "não vender mais do que se tem", segura contra concorrência.
--
-- `select ... for update` trava a linha de collection_items durante toda a
-- transação da venda: uma segunda transação tentando vender o mesmo item
-- ao mesmo tempo BLOQUEIA nesse select até a primeira commitar (ou dar
-- rollback) — só então lê o total já vendido atualizado e valida contra
-- ele. Isso é uma garantia do Postgres (MVCC + row lock), não uma
-- suposição: não existe janela onde duas transações concorrentes possam
-- ler o mesmo "saldo restante" e ambas passarem na validação.
--
-- A trigger dispara em INSERT sempre, e em UPDATE só quando `quantity` ou
-- `collection_item_id` mudam (via `before ... of quantity,
-- collection_item_id` — Postgres restringe isso só ao evento UPDATE;
-- INSERT sempre dispara) — cobre os 3 casos pedidos: criação, alteração de
-- quantidade e realocação para outro item.
--
-- A checagem de ownership (`ci.user_id = new.user_id`) é redundante com a
-- policy de RLS de propósito — defesa em profundidade, mesmo padrão já
-- usado na trigger de imutabilidade de numora_id (Etapa 2): a invariante
-- vale mesmo que a policy de RLS não seja avaliada primeiro (a ordem real
-- de execução do Postgres roda triggers BEFORE INSERT/UPDATE antes do
-- WITH CHECK da RLS) — sem essa checagem aqui, a mensagem de erro de
-- limite poderia vazar a quantidade de um item de outro usuário antes da
-- RLS ter a chance de rejeitar por ownership.
create or replace function public.check_sale_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_quantity integer;
  v_item_user_id  uuid;
  v_sold_quantity integer;
begin
  select quantity, user_id into v_item_quantity, v_item_user_id
  from public.collection_items
  where id = new.collection_item_id
  for update;

  if v_item_quantity is null then
    raise exception 'collection_item referenciado não existe';
  end if;

  if v_item_user_id is distinct from new.user_id then
    raise exception 'collection_item não pertence ao usuário da venda';
  end if;

  select coalesce(sum(quantity), 0) into v_sold_quantity
  from public.sales
  where collection_item_id = new.collection_item_id
    and id is distinct from new.id;

  if v_sold_quantity + new.quantity > v_item_quantity then
    raise exception 'Quantidade vendida (%) excede a quantidade disponível (item: %, já vendido: %)',
      new.quantity, v_item_quantity, v_sold_quantity;
  end if;

  return new;
end;
$$;

revoke execute on function public.check_sale_quantity() from public, anon, authenticated;

create trigger enforce_sale_quantity
  before insert or update of quantity, collection_item_id on public.sales
  for each row
  execute function public.check_sale_quantity();

-- Reaproveita a função já criada na Etapa 2 — nenhuma função nova para
-- manter updated_at corrente.
create trigger set_sales_updated_at
  before update on public.sales
  for each row
  execute function public.set_updated_at();
