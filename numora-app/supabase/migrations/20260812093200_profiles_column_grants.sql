-- ============================================================================
-- RLS por si só restringe LINHA, não COLUNA — a policy "profiles_update_own"
-- já garante que um usuário só pode atualizar a própria linha, mas nada
-- nela impede alterar `id`, `numora_id`, `role` ou `plan_tier` dentro dessa
-- mesma linha. A proteção real de quais colunas um usuário autenticado
-- pode escrever vem de GRANT column-level: revoga o UPDATE amplo e concede
-- apenas nas colunas de perfil que o próprio usuário deve poder editar.
-- (`numora_id` também é protegido por trigger de imutabilidade incondicional
-- — ver 20260812093100_add_numora_id.sql — como segunda camada.)
-- ============================================================================

revoke update on public.profiles from authenticated;

grant update (name, username, avatar_url, country_code, passport_public)
  on public.profiles
  to authenticated;

-- Explicita o `with check` (antes implícito, reaproveitando o `using`) para
-- deixar claro que a linha alterada continua sendo do próprio usuário —
-- mesmo padrão otimizado `(select auth.uid())` já usado nas demais
-- policies (ver 20260812082512_fix_rls_auth_uid_initplan.sql).
alter policy "profiles_update_own"
  on public.profiles
  with check ((select auth.uid()) = id);
