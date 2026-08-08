-- ============================================================================
-- 005_common_functions.sql
-- CoinVerse — Funções auxiliares reutilizadas por triggers/policies em todo
-- o banco. Todas em public/audit, security definer onde precisam contornar
-- RLS (auditoria, checagem de papel).
-- ============================================================================

-- Mantém updated_at sincronizado em qualquer tabela que tenha essa coluna.
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grava linha em audit.audit_logs para INSERT/UPDATE/DELETE. Resiliente:
-- qualquer falha ao capturar contexto (ip/user-agent/jwt) não interrompe a
-- operação original (seção 18.4 do PROJECT_RULES.md).
create or replace function public.fn_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, audit, pg_temp
as $$
declare
  v_actor_id   uuid;
  v_actor_role user_role := 'system';
  v_ip         inet;
  v_ua         text;
  v_request_id text;
  v_action     audit_action;
begin
  begin
    v_actor_id := auth.uid();
  exception when others then
    v_actor_id := null;
  end;

  if v_actor_id is not null then
    select role into v_actor_role from public.profiles where id = v_actor_id;
    v_actor_role := coalesce(v_actor_role, 'user');
  end if;

  begin
    v_ip := nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', '')::inet;
  exception when others then
    v_ip := null;
  end;

  begin
    v_ua := current_setting('request.headers', true)::jsonb ->> 'user-agent';
  exception when others then
    v_ua := null;
  end;

  begin
    v_request_id := current_setting('request.headers', true)::jsonb ->> 'x-request-id';
  exception when others then
    v_request_id := null;
  end;

  v_action := case TG_OP when 'INSERT' then 'insert' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end;

  insert into audit.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    before_data, after_data, ip_address, user_agent, request_id
  ) values (
    v_actor_id, v_actor_role, v_action, TG_TABLE_NAME,
    coalesce((case when TG_OP = 'DELETE' then old.id else new.id end), null),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE','INSERT') then to_jsonb(new) else null end,
    v_ip, v_ua, v_request_id
  );

  return coalesce(new, old);
exception when others then
  -- Auditoria nunca pode derrubar a transação de negócio.
  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- Converte DELETE em soft delete (UPDATE deleted_at = now()) para tabelas
-- de entidade de negócio. Anexar como BEFORE DELETE FOR EACH ROW.
create or replace function public.fn_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  execute format('update %I.%I set deleted_at = now() where id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
  using old.id;
  return null; -- cancela o DELETE físico
end;
$$;

-- ----------------------------------------------------------------------------
create or replace function public.fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.fn_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('moderator','admin')
  );
$$;

-- ----------------------------------------------------------------------------
-- Cria (idempotente) a partição mensal de uma tabela particionada por
-- RANGE(created_at) no formato <tabela>_yYYYY_mMM.
create or replace function public.fn_create_monthly_partition(
  p_schema text,
  p_table  text,
  p_date   date
)
returns void
language plpgsql
as $$
declare
  v_start date := date_trunc('month', p_date)::date;
  v_end   date := (date_trunc('month', p_date) + interval '1 month')::date;
  v_name  text := format('%s_y%sm%s', p_table, to_char(v_start,'YYYY'), to_char(v_start,'MM'));
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema and c.relname = v_name
  ) then
    execute format(
      'create table %I.%I partition of %I.%I for values from (%L) to (%L)',
      p_schema, v_name, p_schema, p_table, v_start, v_end
    );
  end if;
end;
$$;

-- Cria as partições do mês corrente e do próximo para as tabelas de auditoria.
select public.fn_create_monthly_partition('audit', 'audit_logs', current_date);
select public.fn_create_monthly_partition('audit', 'audit_logs', (current_date + interval '1 month')::date);
select public.fn_create_monthly_partition('audit', 'system_logs', current_date);
select public.fn_create_monthly_partition('audit', 'system_logs', (current_date + interval '1 month')::date);
select public.fn_create_monthly_partition('audit', 'error_logs', current_date);
select public.fn_create_monthly_partition('audit', 'error_logs', (current_date + interval '1 month')::date);
