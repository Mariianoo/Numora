-- ============================================================================
-- 009_tables_module_d_e_grading_media.sql
-- CoinVerse — Módulo D (Grading) e Módulo E (Fotos & Mídia).
-- grading_records e item_photos/certificates são majoritariamente append-only
-- (histórico de alterações nativo — ver PROJECT_RULES.md seção 1.8/32).
-- ============================================================================

create table if not exists public.grading_records (
  id                       uuid primary key default gen_random_uuid(),
  collection_item_id       uuid not null references public.collection_items (id) on delete cascade,
  grading_scale            grading_scale not null,
  grade_value              text not null,
  graded_by                grading_source not null,
  grader_user_id           uuid references public.profiles (id) on delete set null,
  notes                    text,
  certificate_photo_path   text,
  created_at               timestamptz not null default now()
);

create index if not exists idx_grading_records_collection_item_id on public.grading_records (collection_item_id);

drop trigger if exists trg_grading_records_audit on public.grading_records;
create trigger trg_grading_records_audit
  after insert on public.grading_records
  for each row execute function public.fn_audit_trigger();

comment on table public.grading_records is 'Append-only: correção de grading é nova linha, nunca UPDATE (sem trigger de update/delete).';

-- ----------------------------------------------------------------------------

create table if not exists public.item_photos (
  id                   uuid primary key default gen_random_uuid(),
  collection_item_id   uuid not null references public.collection_items (id) on delete cascade,
  storage_path         text not null,
  angle                photo_angle not null default 'front',
  is_primary           boolean not null default false,
  width                int,
  height               int,
  taken_offline        boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_item_photos_collection_item_id on public.item_photos (collection_item_id);
create unique index if not exists uq_item_photos_primary_per_item
  on public.item_photos (collection_item_id, angle) where is_primary;

drop trigger if exists trg_item_photos_updated_at on public.item_photos;
create trigger trg_item_photos_updated_at
  before update on public.item_photos
  for each row execute function public.fn_set_updated_at();

-- ----------------------------------------------------------------------------

create table if not exists public.certificates (
  id                   uuid primary key default gen_random_uuid(),
  collection_item_id   uuid not null references public.collection_items (id) on delete cascade,
  issuer               text not null,
  storage_path         text not null,
  issued_at            date,
  created_at           timestamptz not null default now()
);

create index if not exists idx_certificates_collection_item_id on public.certificates (collection_item_id);
