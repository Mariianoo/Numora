-- coins: itens da coleção de moedas de cada usuário.
create table if not exists public.coins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  country text not null,
  year integer,
  value numeric,
  description text,
  image_url text,
  price_paid numeric,
  created_at timestamptz not null default now()
);

create index if not exists coins_user_id_idx on public.coins (user_id);

alter table public.coins enable row level security;

create policy "coins_select_own"
  on public.coins
  for select
  using (auth.uid() = user_id);

create policy "coins_insert_own"
  on public.coins
  for insert
  with check (auth.uid() = user_id);

create policy "coins_delete_own"
  on public.coins
  for delete
  using (auth.uid() = user_id);
