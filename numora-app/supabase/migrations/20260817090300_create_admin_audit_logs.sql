-- ============================================================================
-- Etapa 15.3 (Admin Control Center) — trilha de auditoria administrativa.
--
-- INSERT nunca é feito diretamente pelo client contra a tabela — só através
-- da função `log_admin_action()` abaixo (security definer), que força
-- `actor_user_id = auth.uid()` incondicionalmente (nunca aceita de fora,
-- mesmo padrão de ownership resolvido no servidor já usado em todo o
-- projeto) e recusa registrar se o chamador não for administrador —
-- segunda camada de defesa, mesmo que só código já gated chame isto hoje.
--
-- RLS "extremamente restritiva" pedida explicitamente: só SELECT para
-- administradores, nenhuma policy de UPDATE/DELETE (log é imutável — sem
-- policy de escrita, o Postgres nega por padrão) e nenhum GRANT de INSERT
-- direto para `authenticated` (só a function, via security definer,
-- consegue inserir).
-- ============================================================================

create table public.admin_audit_logs (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid not null references public.profiles (id) on delete restrict,
  action          text not null,
  target_user_id  uuid references public.profiles (id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.admin_audit_logs is
  'Etapa 15.3 — trilha de auditoria administrativa (quem fez o quê, em quem, quando). Nunca armazenar senha/token/secret em metadata. Imutável: sem policy de update/delete.';

create index idx_admin_audit_logs_created_at on public.admin_audit_logs (created_at desc);
create index idx_admin_audit_logs_target on public.admin_audit_logs (target_user_id);

alter table public.admin_audit_logs enable row level security;

create policy "admin_audit_logs_select_admin"
  on public.admin_audit_logs
  for select
  using (public.is_platform_admin());

-- Nenhum GRANT de INSERT/UPDATE/DELETE para `authenticated` nesta tabela —
-- a única porta de escrita é a function abaixo.
revoke insert, update, delete on public.admin_audit_logs from authenticated;

create or replace function public.log_admin_action(
  p_action text,
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.admin_audit_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.admin_audit_logs;
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas administradores podem registrar ações administrativas.' using errcode = '42501';
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, target_user_id, metadata)
  values ((select auth.uid()), p_action, p_target_user_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.log_admin_action(text, uuid, jsonb) from public, anon;
grant execute on function public.log_admin_action(text, uuid, jsonb) to authenticated;

comment on function public.log_admin_action(text, uuid, jsonb) is
  'Etapa 15.3 — único caminho de escrita em admin_audit_logs. actor_user_id sempre = auth.uid() (nunca vindo do chamador); recusa se o chamador não for admin.';
