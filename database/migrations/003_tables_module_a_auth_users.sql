-- ============================================================================
-- 003_tables_module_a_auth_users.sql
-- CoinVerse — Módulo A: Autenticação & Usuários.
-- Criadas ANTES das tabelas de auditoria (004) porque audit_logs referencia
-- profiles/user_devices via FK. Triggers de updated_at/auditoria são
-- anexados em 006_triggers_module_a.sql, após as funções (005) existirem.
-- ============================================================================

create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           text not null,
  display_name       text not null,
  avatar_path        text,
  bio                text,
  country_code       char(2),
  role               user_role not null default 'user',
  plan_tier          subscription_tier not null default 'free',
  is_verified_seller boolean not null default false,
  locale             text not null default 'pt-BR',
  last_active_at     timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_profiles_username_length check (char_length(username) between 3 and 30),
  constraint uq_profiles_username unique (username)
);

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_username_trgm on public.profiles using gin (username gin_trgm_ops);

comment on table public.profiles is 'Extensão pública de auth.users. Exclusão real proibida (LGPD/soft delete via deleted_at).';

-- ----------------------------------------------------------------------------

create table if not exists public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        user_role not null,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  constraint pk_user_roles primary key (user_id, role)
);

create index if not exists idx_user_roles_user_id on public.user_roles (user_id);

-- ----------------------------------------------------------------------------

create table if not exists public.user_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  device_type   device_type not null,
  push_token    text,
  device_name   text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_user_devices_user_token unique (user_id, push_token)
);

create index if not exists idx_user_devices_user_id on public.user_devices (user_id);

-- ----------------------------------------------------------------------------

create table if not exists public.user_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  device_id    uuid references public.user_devices (id) on delete set null,
  ip_address   inet not null,
  user_agent   text not null,
  revoked_at   timestamptz,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_user_sessions_user_id on public.user_sessions (user_id);
create index if not exists idx_user_sessions_expires_at on public.user_sessions (expires_at);
