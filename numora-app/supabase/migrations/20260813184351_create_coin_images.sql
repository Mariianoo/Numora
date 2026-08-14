-- ============================================================================
-- Fase 1, Etapa 9.1 — `coin_images`: metadados das fotos (frente/verso/
-- borda) de um exemplar físico (`collection_units`). Os BYTES da imagem
-- vivem no Storage (bucket `coin-images`, ver
-- `20260813184500_create_coin_images_storage_bucket.sql`); esta tabela só
-- guarda o caminho determinístico (`storage_path`), dimensões e tamanho —
-- nunca uma URL pública, nunca o binário.
--
-- `UNIQUE (collection_unit_id, kind)`: no máximo 1 foto de cada tipo por
-- exemplar — "substituir uma foto" é upsert no mesmo path, não duas
-- linhas para o mesmo (exemplar, tipo). `UNIQUE (storage_path)`: o path
-- determinístico `{user_id}/{collection_unit_id}/{kind}.webp` já garante
-- unicidade lógica; a constraint só a torna explícita no schema.
--
-- Reconstruída nesta auditoria (Etapa 10) a partir do estado real do
-- banco — arquivo original nunca foi commitado no repositório. Todos os
-- objetos abaixo foram verificados via information_schema/pg_constraint/
-- pg_trigger/pg_policies contra o schema hoje existente. Esta migration
-- NÃO revoga o acesso de `anon` — isso é feito à parte, em
-- `20260813184441_revoke_anon_coin_images.sql`, pois o Supabase concede
-- grants padrão de tabela a `anon`/`authenticated` na criação (mesmo
-- comportamento de `collection_items`/`collection_units`), e aqui essa
-- concessão default precisou ser revertida explicitamente depois.
-- ============================================================================

create table public.coin_images (
  id                  uuid primary key default gen_random_uuid(),
  collection_unit_id  uuid not null references public.collection_units (id) on delete cascade,
  kind                text not null check (kind in ('front', 'back', 'edge')),
  storage_path        text not null unique,
  width               integer not null check (width > 0),
  height              integer not null check (height > 0),
  file_size           integer not null check (file_size > 0),
  mime_type           text not null default 'image/webp',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (collection_unit_id, kind)
);

alter table public.coin_images enable row level security;

create policy "coin_images_select_own"
  on public.coin_images
  for select
  using (exists (
    select 1 from public.collection_units cu
    join public.collection_items ci on ci.id = cu.collection_item_id
    where cu.id = coin_images.collection_unit_id and ci.user_id = (select auth.uid())
  ));

create policy "coin_images_insert_own"
  on public.coin_images
  for insert
  with check (exists (
    select 1 from public.collection_units cu
    join public.collection_items ci on ci.id = cu.collection_item_id
    where cu.id = coin_images.collection_unit_id and ci.user_id = (select auth.uid())
  ));

create policy "coin_images_update_own"
  on public.coin_images
  for update
  using (exists (
    select 1 from public.collection_units cu
    join public.collection_items ci on ci.id = cu.collection_item_id
    where cu.id = coin_images.collection_unit_id and ci.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.collection_units cu
    join public.collection_items ci on ci.id = cu.collection_item_id
    where cu.id = coin_images.collection_unit_id and ci.user_id = (select auth.uid())
  ));

create policy "coin_images_delete_own"
  on public.coin_images
  for delete
  using (exists (
    select 1 from public.collection_units cu
    join public.collection_items ci on ci.id = cu.collection_item_id
    where cu.id = coin_images.collection_unit_id and ci.user_id = (select auth.uid())
  ));

-- Reaproveita a função já criada na Etapa 2 — nenhuma função nova.
create trigger set_coin_images_updated_at
  before update on public.coin_images
  for each row
  execute function public.set_updated_at();
