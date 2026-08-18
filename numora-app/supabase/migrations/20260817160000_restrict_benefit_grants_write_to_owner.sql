-- ============================================================================
-- Etapa 15.8-R3 (Correção de Autorização de benefit_grants) — cortesia é
-- decisão comercial, exclusiva do OWNER.
--
-- ACHADO (Etapa 15.8-R2): `benefit_grants_admin_all` (Etapa 15.3) usa
-- `is_platform_admin()` para TODOS os comandos (SELECT/INSERT/UPDATE/
-- DELETE) — como `is_platform_admin()` retorna true para owner E admin,
-- um ADMIN comum consegue hoje conceder/revogar cortesia, o que tem valor
-- comercial direto. Decisão do OWNER (Etapa 15.8-R3): corrigir agora.
--
-- Dependência conhecida e conscientemente aceita: `/admin/members`
-- (Etapa 15.3) tem botões "Conceder cortesia"/"Revogar cortesia"
-- acessíveis tanto a owner quanto a admin (gated por `requireAdmin()` =
-- owner OU admin). Após esta migration, um ADMIN (não owner) que clicar
-- nesses botões recebe erro de RLS — comportamento intencional desta
-- correção, não uma regressão a evitar. Nenhuma UI foi alterada nesta
-- etapa (fora de escopo) — o ajuste de UI (ex.: ocultar os botões para
-- admin comum) fica para uma etapa futura, se o Owner decidir.
--
-- SELECT permanece EXATAMENTE como estava (is_platform_admin()) — só
-- INSERT/UPDATE/DELETE mudam para is_platform_owner(). `is_platform_
-- owner()` já existe (Etapa 15.7) e é reutilizada sem alteração —
-- nenhuma função nova, nenhuma duplicação de lógica.
-- ============================================================================

drop policy "benefit_grants_admin_all" on public.benefit_grants;

create policy "benefit_grants_select_admin"
  on public.benefit_grants
  for select
  using (public.is_platform_admin());

create policy "benefit_grants_owner_insert"
  on public.benefit_grants
  for insert
  with check (public.is_platform_owner());

create policy "benefit_grants_owner_update"
  on public.benefit_grants
  for update
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create policy "benefit_grants_owner_delete"
  on public.benefit_grants
  for delete
  using (public.is_platform_owner());
