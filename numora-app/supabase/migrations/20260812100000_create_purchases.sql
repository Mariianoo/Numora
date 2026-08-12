-- ============================================================================
-- Fase 1, Etapa 3 — `purchases`: entidade de transação de aquisição.
--
-- `total_price` é o valor TOTAL da transação, nunca preço unitário. Uma
-- purchase pode no futuro estar associada a vários `collection_items`
-- (lote: várias moedas diferentes compradas juntas por um preço total) —
-- essa relação nasce em `collection_items.purchase_id` (Etapa 4), não
-- aqui. De propósito, esta tabela NÃO tem `collection_item_id` nem
-- qualquer conceito de "lote" — é puramente o registro financeiro da
-- transação: purchases 1 ─── N collection_items.
-- ============================================================================

create table public.purchases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  total_price    numeric(12, 2) not null check (total_price >= 0),
  currency       char(3) not null default 'BRL',
  purchase_date  date,
  seller_name    text,
  seller_contact text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.purchases is
  'Transação de aquisição. total_price é o valor TOTAL da transação, não unitário. Relação com collection_items nasce em collection_items.purchase_id (Etapa 4) — 1 purchase pode cobrir N itens (lote).';

comment on column public.purchases.total_price is
  'Valor total pago na transação (não por peça). numeric(12,2): 2 casas decimais cobre BRL/USD/EUR — as moedas hoje suportadas (campo `currency`, default BRL). Moedas com convenção de casas decimais diferente (ex.: JPY=0, KWD=3) exigiriam uma tabela de metadados de moeda própria; deliberadamente fora de escopo até o produto de fato suportar múltiplas moedas.';

alter table public.purchases enable row level security;

create policy "purchases_select_own"
  on public.purchases
  for select
  using ((select auth.uid()) = user_id);

create policy "purchases_insert_own"
  on public.purchases
  for insert
  with check ((select auth.uid()) = user_id);

create policy "purchases_update_own"
  on public.purchases
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "purchases_delete_own"
  on public.purchases
  for delete
  using ((select auth.uid()) = user_id);

-- Toda leitura passa por RLS filtrando por user_id primeiro — por isso um
-- índice de purchase_date isolado não ajudaria nenhum acesso real (nunca
-- se consulta purchase_date sem estar implicitamente escopado a um
-- usuário). O composto (user_id, purchase_date desc) cobre tanto o filtro
-- de RLS quanto a ordenação típica de listagem ("compras mais recentes
-- primeiro"), e por prefixo também serve consultas só por user_id — um
-- índice extra só em user_id seria redundante.
create index idx_purchases_user_date on public.purchases (user_id, purchase_date desc);

-- Reaproveita a função já criada na Etapa 2 (SECURITY DEFINER, search_path
-- fixo, EXECUTE já revogado de public/anon/authenticated) — nenhuma
-- função nova necessária para manter updated_at corrente.
create trigger set_purchases_updated_at
  before update on public.purchases
  for each row
  execute function public.set_updated_at();
