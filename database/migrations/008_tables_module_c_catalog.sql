-- ============================================================================
-- 008_tables_module_c_catalog.sql
-- CoinVerse — Módulo C: Catálogo Mestre (dados de referência, curadoria admin).
-- ============================================================================

create table if not exists public.catalog_countries (
  id            uuid primary key default gen_random_uuid(),
  iso_code      char(2) not null,
  name          text not null,
  currency_code char(3),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_catalog_countries_iso unique (iso_code)
);

drop trigger if exists trg_catalog_countries_updated_at on public.catalog_countries;
create trigger trg_catalog_countries_updated_at
  before update on public.catalog_countries
  for each row execute function public.fn_set_updated_at();

-- ----------------------------------------------------------------------------

create table if not exists public.catalog_series (
  id                 uuid primary key default gen_random_uuid(),
  country_id         uuid not null references public.catalog_countries (id) on delete restrict,
  name               text not null,
  period_start_year  int,
  period_end_year    int,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_catalog_series_country_id on public.catalog_series (country_id);

drop trigger if exists trg_catalog_series_updated_at on public.catalog_series;
create trigger trg_catalog_series_updated_at
  before update on public.catalog_series
  for each row execute function public.fn_set_updated_at();

-- ----------------------------------------------------------------------------

create table if not exists public.catalog_mints (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  country_id  uuid references public.catalog_countries (id) on delete set null,
  mint_mark   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_catalog_mints_country_id on public.catalog_mints (country_id);

drop trigger if exists trg_catalog_mints_updated_at on public.catalog_mints;
create trigger trg_catalog_mints_updated_at
  before update on public.catalog_mints
  for each row execute function public.fn_set_updated_at();

-- ----------------------------------------------------------------------------

create table if not exists public.catalog_items (
  id             uuid primary key default gen_random_uuid(),
  item_type      catalog_item_type not null,
  country_id     uuid references public.catalog_countries (id) on delete set null,
  series_id      uuid references public.catalog_series (id) on delete set null,
  name           text not null,
  year           int,
  material       coin_material,
  face_value     numeric(14,4),
  mintage        bigint,
  description    text,
  attributes     jsonb not null default '{}'::jsonb,
  search_vector  tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(description, '')), 'B')
  ) stored,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_catalog_items_country_id on public.catalog_items (country_id);
create index if not exists idx_catalog_items_series_id on public.catalog_items (series_id);
create index if not exists idx_catalog_items_year on public.catalog_items (year);
create index if not exists gin_catalog_items_search_vector on public.catalog_items using gin (search_vector);
create index if not exists gin_catalog_items_attributes on public.catalog_items using gin (attributes);

drop trigger if exists trg_catalog_items_updated_at on public.catalog_items;
create trigger trg_catalog_items_updated_at
  before update on public.catalog_items
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_catalog_items_audit on public.catalog_items;
create trigger trg_catalog_items_audit
  after insert or update or delete on public.catalog_items
  for each row execute function public.fn_audit_trigger();

-- ----------------------------------------------------------------------------
-- Fecha a FK pendente de collection_items.catalog_item_id (definida em 007
-- antes de catalog_items existir).

do $$ begin
  alter table public.collection_items
    add constraint fk_collection_items_catalog_item
    foreign key (catalog_item_id) references public.catalog_items (id) on delete restrict;
exception when duplicate_object then null; end $$;

create index if not exists idx_collection_items_catalog_item_id on public.collection_items (catalog_item_id);
