-- ============================================================================
-- 004_audit_and_system_logs_tables.sql
-- CoinVerse — audit.audit_logs / audit.system_logs / audit.error_logs.
-- Tabelas particionadas por RANGE(created_at), granularidade mensal, para
-- suportar alto volume (ver DATABASE_ARCHITECTURE.md, seções 1.3 e 6).
-- Partições são criadas por public.fn_create_monthly_partition() (005),
-- chamada ao final deste arquivo para o mês corrente e o seguinte.
-- ============================================================================

create table if not exists audit.audit_logs (
  id           uuid not null default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_role   user_role not null default 'system',
  action       audit_action not null,
  entity_type  text not null,
  entity_id    uuid,
  before_data  jsonb,
  after_data   jsonb,
  ip_address   inet,
  user_agent   text,
  device_id    uuid references public.user_devices (id) on delete set null,
  session_id   uuid,
  request_id   text,
  constraint pk_audit_logs primary key (id, created_at)
) partition by range (created_at);

-- Partição catch-all para datas fora de qualquer partição mensal criada.
create table if not exists audit.audit_logs_default partition of audit.audit_logs default;

create index if not exists idx_audit_logs_actor_id on audit.audit_logs (actor_id);
create index if not exists idx_audit_logs_entity on audit.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_action on audit.audit_logs (action);

comment on table audit.audit_logs is 'Auditoria imutável. insert apenas via service_role; sem update/delete para nenhum papel (ver policies).';

-- ----------------------------------------------------------------------------

create table if not exists audit.system_logs (
  id          uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  level       text not null check (level in ('debug','info','warn','error','fatal')),
  source      text not null,
  message     text not null,
  context     jsonb not null default '{}'::jsonb,
  request_id  text,
  constraint pk_system_logs primary key (id, created_at)
) partition by range (created_at);

create table if not exists audit.system_logs_default partition of audit.system_logs default;

create index if not exists idx_system_logs_level on audit.system_logs (level);
create index if not exists idx_system_logs_source on audit.system_logs (source);

-- ----------------------------------------------------------------------------

create table if not exists audit.error_logs (
  id            uuid not null default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  error_type    text not null,
  message       text not null,
  stack_trace   text,
  user_id       uuid references public.profiles (id) on delete set null,
  request_id    text,
  context       jsonb not null default '{}'::jsonb,
  constraint pk_error_logs primary key (id, created_at)
) partition by range (created_at);

create table if not exists audit.error_logs_default partition of audit.error_logs default;

create index if not exists idx_error_logs_user_id on audit.error_logs (user_id);
create index if not exists idx_error_logs_error_type on audit.error_logs (error_type);
