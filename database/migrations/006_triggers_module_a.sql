-- ============================================================================
-- 006_triggers_module_a.sql
-- CoinVerse — Triggers de updated_at + auditoria para as tabelas do Módulo A.
-- Idempotente via drop trigger if exists.
-- ============================================================================

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.fn_audit_trigger();

-- ----------------------------------------------------------------------------

drop trigger if exists trg_user_roles_audit on public.user_roles;
create trigger trg_user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function public.fn_audit_trigger();

-- ----------------------------------------------------------------------------

drop trigger if exists trg_user_devices_updated_at on public.user_devices;
create trigger trg_user_devices_updated_at
  before update on public.user_devices
  for each row execute function public.fn_set_updated_at();

-- user_sessions e user_devices não são auditados linha a linha (alto volume,
-- baixo valor de auditoria individual) — cobertos por audit_action 'login'/
-- 'logout' emitido explicitamente pela Edge Function de autenticação.
