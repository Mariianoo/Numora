-- ============================================================================
-- 007_tables_module_b_collections.sql
-- CoinVerse — Módulo B: Coleções.
-- Referencia public.catalog_items (criada em 008); FK adicionada via ALTER
-- ao final de 008 para evitar dependência circular entre arquivos.
-- ============================================================================

create table if not exists public.collections (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  name              text not null,
  description       text,
  is_public         boolean not null default false,
  cover_photo_path  text,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_collections_owner_id on public.collections (owner_id);
create index if not exists idx_collections_public on public.collections (is_public) where is_public and deleted_at is null;

drop trigger if exists trg_collections_updated_at on public.collections;
create trigger trg_collections_updated_at
  before update on public.collections
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_collections_soft_delete on public.collections;
create trigger trg_collections_soft_delete
  before delete on public.collections
  for each row execute function public.fn_soft_delete();

drop trigger if exists trg_collections_audit on public.collections;
create trigger trg_collections_audit
  after insert or update or delete on public.collections
  for each row execute function public.fn_audit_trigger();

-- ----------------------------------------------------------------------------

create table if not exists public.collection_items (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  collection_id         uuid references public.collections (id) on delete set null,
  catalog_item_id       uuid, -- FK adicionada em 008 (catalog_items ainda não existe)
  custom_name           text,
  condition_grade       text,
  acquisition_date      date,
  acquisition_price     numeric(12,2),
  acquisition_currency  char(3) not null default 'BRL',
  estimated_value       numeric(12,2),
  notes                 text,
  is_for_trade          boolean not null default false,
  visibility            item_visibility not null default 'private',
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_collection_items_name check (catalog_item_id is not null or custom_name is not null)
);

create index if not exists idx_collection_items_owner_id on public.collection_items (owner_id);
create index if not exists idx_collection_items_collection_id on public.collection_items (collection_id);
create index if not exists idx_collection_items_active on public.collection_items (owner_id) where deleted_at is null;

drop trigger if exists trg_collection_items_updated_at on public.collection_items;
create trigger trg_collection_items_updated_at
  before update on public.collection_items
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_collection_items_soft_delete on public.collection_items;
create trigger trg_collection_items_soft_delete
  before delete on public.collection_items
  for each row execute function public.fn_soft_delete();

drop trigger if exists trg_collection_items_audit on public.collection_items;
create trigger trg_collection_items_audit
  after insert or update or delete on public.collection_items
  for each row execute function public.fn_audit_trigger();
