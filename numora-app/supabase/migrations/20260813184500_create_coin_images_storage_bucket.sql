-- ============================================================================
-- Fase 1, Etapa 9.1 — bucket `coin-images` (privado) e suas Storage
-- policies. Path determinístico `{user_id}/{collection_unit_id}/{kind}.webp`
-- — a policy usa `storage.foldername(name)[1]` (primeiro segmento do
-- path) comparado a `auth.uid()` como o mecanismo real de ownership,
-- independente da linha em `coin_images` existir ou não. Acesso é sempre
-- via signed URL de curta duração (`createSignedUrl`/`createSignedUrls`,
-- camada de aplicação) — nunca URL pública, porque o bucket é privado.
--
-- Diferente de `revoke_anon_coin_images.sql` (tabela `coin_images`),
-- aqui as 4 policies já nascem escopadas só para `authenticated` — não
-- há grant automático de Storage para `anon` a revogar depois; o Storage
-- do Supabase não segue o mesmo padrão de ALTER DEFAULT PRIVILEGES de
-- tabelas comuns.
--
-- Reconstruída nesta auditoria (Etapa 10) a partir do estado real do
-- banco — arquivo original nunca foi commitado no repositório. Bucket e
-- as 4 policies verificados via storage.buckets e pg_policies
-- (schemaname='storage', tablename='objects') contra o estado hoje
-- existente.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('coin-images', 'coin-images', false);

create policy "coin_images_objects_select_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'coin-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "coin_images_objects_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'coin-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "coin_images_objects_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'coin-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'coin-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "coin_images_objects_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'coin-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
