-- ============================================================================
-- Fase 1, Etapa 8.2 — garante que nenhum perfil fique com `passport_public
-- = true` sem `username` definido: o Passport público é acessado por
-- username (`get_public_passport`, ver migration seguinte), então um
-- perfil "público" sem username seria inacessível por design, um estado
-- inconsistente que o CHECK impede na origem.
--
-- Reconstruída nesta auditoria (Etapa 10) a partir do estado real do
-- banco — arquivo original nunca foi commitado no repositório. SQL
-- verificado via pg_get_constraintdef() contra o constraint
-- `chk_profiles_passport_requires_username` hoje existente em
-- `public.profiles`. `uq_profiles_username` já existia desde
-- `20260812093000_extend_profiles_columns.sql` — não recriada aqui.
-- ============================================================================

alter table public.profiles
  add constraint chk_profiles_passport_requires_username
  check (passport_public = false or username is not null);
