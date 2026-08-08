-- ============================================================================
-- 010_rls_policies_part1.sql
-- CoinVerse — RLS habilitado (fail-closed) + policies para Módulos A-E e
-- tabelas de auditoria criadas neste lote.
-- Idempotente: drop policy if exists antes de cada create policy.
-- ============================================================================

-- ===================== profiles =====================
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_own_or_public on public.profiles;
create policy profiles_select_own_or_public on public.profiles
  for select using (auth.uid() = id or deleted_at is null);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles p where p.id = auth.uid())
    and plan_tier = (select plan_tier from public.profiles p where p.id = auth.uid())
    and is_verified_seller = (select is_verified_seller from public.profiles p where p.id = auth.uid())
  );
-- role/plan_tier/is_verified_seller só mudam via service_role (bypassa RLS).

-- insert: apenas via trigger de criação de usuário (service_role) — nenhuma
-- policy de insert concedida a authenticated/anon.
-- delete: proibido — nenhuma policy de delete concedida.

-- ===================== user_roles =====================
alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;

drop policy if exists user_roles_select_own_or_admin on public.user_roles;
create policy user_roles_select_own_or_admin on public.user_roles
  for select using (auth.uid() = user_id or public.fn_is_admin());

-- insert/update/delete: apenas service_role/admin via Edge Function (sem policy
-- para authenticated).

-- ===================== user_devices =====================
alter table public.user_devices enable row level security;
alter table public.user_devices force row level security;

drop policy if exists user_devices_all_own on public.user_devices;
create policy user_devices_all_own on public.user_devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===================== user_sessions =====================
alter table public.user_sessions enable row level security;
alter table public.user_sessions force row level security;

drop policy if exists user_sessions_select_own on public.user_sessions;
create policy user_sessions_select_own on public.user_sessions
  for select using (auth.uid() = user_id);

drop policy if exists user_sessions_delete_own on public.user_sessions;
create policy user_sessions_delete_own on public.user_sessions
  for delete using (auth.uid() = user_id);
-- insert: apenas service_role (Edge Function de login).

-- ===================== audit.audit_logs / system_logs / error_logs =====================
alter table audit.audit_logs enable row level security;
alter table audit.audit_logs force row level security;

drop policy if exists audit_logs_select_admin on audit.audit_logs;
create policy audit_logs_select_admin on audit.audit_logs
  for select using (public.fn_is_admin());
-- insert: apenas service_role (função fn_audit_trigger roda como security definer).
-- sem update/delete para nenhum papel — imutabilidade garantida pela ausência de policy.

alter table audit.system_logs enable row level security;
alter table audit.system_logs force row level security;

drop policy if exists system_logs_select_admin on audit.system_logs;
create policy system_logs_select_admin on audit.system_logs
  for select using (public.fn_is_admin());

alter table audit.error_logs enable row level security;
alter table audit.error_logs force row level security;

drop policy if exists error_logs_select_admin on audit.error_logs;
create policy error_logs_select_admin on audit.error_logs
  for select using (public.fn_is_admin());

-- ===================== collections =====================
alter table public.collections enable row level security;
alter table public.collections force row level security;

drop policy if exists collections_select_own_or_public on public.collections;
create policy collections_select_own_or_public on public.collections
  for select using (
    deleted_at is null and (owner_id = auth.uid() or is_public)
  );

drop policy if exists collections_insert_own on public.collections;
create policy collections_insert_own on public.collections
  for insert with check (owner_id = auth.uid());

drop policy if exists collections_update_own on public.collections;
create policy collections_update_own on public.collections
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists collections_delete_own on public.collections;
create policy collections_delete_own on public.collections
  for delete using (owner_id = auth.uid());

-- ===================== collection_items =====================
alter table public.collection_items enable row level security;
alter table public.collection_items force row level security;

drop policy if exists collection_items_select_visible on public.collection_items;
create policy collection_items_select_visible on public.collection_items
  for select using (
    deleted_at is null and (owner_id = auth.uid() or visibility = 'public')
  );

drop policy if exists collection_items_insert_own on public.collection_items;
create policy collection_items_insert_own on public.collection_items
  for insert with check (owner_id = auth.uid());

drop policy if exists collection_items_update_own on public.collection_items;
create policy collection_items_update_own on public.collection_items
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists collection_items_delete_own on public.collection_items;
create policy collection_items_delete_own on public.collection_items
  for delete using (owner_id = auth.uid());

-- ===================== catalog_countries / series / mints / items =====================
alter table public.catalog_countries enable row level security;
alter table public.catalog_countries force row level security;
drop policy if exists catalog_countries_select_public on public.catalog_countries;
create policy catalog_countries_select_public on public.catalog_countries for select using (true);
drop policy if exists catalog_countries_write_admin on public.catalog_countries;
create policy catalog_countries_write_admin on public.catalog_countries
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

alter table public.catalog_series enable row level security;
alter table public.catalog_series force row level security;
drop policy if exists catalog_series_select_public on public.catalog_series;
create policy catalog_series_select_public on public.catalog_series for select using (true);
drop policy if exists catalog_series_write_admin on public.catalog_series;
create policy catalog_series_write_admin on public.catalog_series
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

alter table public.catalog_mints enable row level security;
alter table public.catalog_mints force row level security;
drop policy if exists catalog_mints_select_public on public.catalog_mints;
create policy catalog_mints_select_public on public.catalog_mints for select using (true);
drop policy if exists catalog_mints_write_admin on public.catalog_mints;
create policy catalog_mints_write_admin on public.catalog_mints
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

alter table public.catalog_items enable row level security;
alter table public.catalog_items force row level security;
drop policy if exists catalog_items_select_public on public.catalog_items;
create policy catalog_items_select_public on public.catalog_items
  for select using (deleted_at is null);
drop policy if exists catalog_items_write_admin on public.catalog_items;
create policy catalog_items_write_admin on public.catalog_items
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ===================== grading_records =====================
alter table public.grading_records enable row level security;
alter table public.grading_records force row level security;

drop policy if exists grading_records_select_visible on public.grading_records;
create policy grading_records_select_visible on public.grading_records
  for select using (
    exists (
      select 1 from public.collection_items ci
      where ci.id = grading_records.collection_item_id
        and ci.deleted_at is null
        and (ci.owner_id = auth.uid() or ci.visibility = 'public')
    )
  );

drop policy if exists grading_records_insert_owner on public.grading_records;
create policy grading_records_insert_owner on public.grading_records
  for insert with check (
    exists (
      select 1 from public.collection_items ci
      where ci.id = grading_records.collection_item_id and ci.owner_id = auth.uid()
    )
  );
-- sem update/delete — histórico imutável.

-- ===================== item_photos =====================
alter table public.item_photos enable row level security;
alter table public.item_photos force row level security;

drop policy if exists item_photos_select_visible on public.item_photos;
create policy item_photos_select_visible on public.item_photos
  for select using (
    exists (
      select 1 from public.collection_items ci
      where ci.id = item_photos.collection_item_id
        and ci.deleted_at is null
        and (ci.owner_id = auth.uid() or ci.visibility = 'public')
    )
  );

drop policy if exists item_photos_write_owner on public.item_photos;
create policy item_photos_write_owner on public.item_photos
  for all using (
    exists (select 1 from public.collection_items ci where ci.id = item_photos.collection_item_id and ci.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.collection_items ci where ci.id = item_photos.collection_item_id and ci.owner_id = auth.uid())
  );

-- ===================== certificates =====================
alter table public.certificates enable row level security;
alter table public.certificates force row level security;

drop policy if exists certificates_all_owner on public.certificates;
create policy certificates_all_owner on public.certificates
  for all using (
    exists (select 1 from public.collection_items ci where ci.id = certificates.collection_item_id and ci.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.collection_items ci where ci.id = certificates.collection_item_id and ci.owner_id = auth.uid())
  );
