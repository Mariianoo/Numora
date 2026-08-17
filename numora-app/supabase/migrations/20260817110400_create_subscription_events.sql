-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — log append-only de transições de estado
-- de assinatura.
--
-- Complementa (não substitui) `admin_audit_logs`: `admin_audit_logs`
-- registra AÇÕES administrativas (quem fez o quê); `subscription_events`
-- registra toda TRANSIÇÃO de estado de uma subscription, com ou sem ator
-- humano (`source` = webhook/admin/reconciliation).
--
-- Mesmo padrão de imutabilidade de `admin_audit_logs` (Etapa 15.3): RLS só
-- com policy de SELECT (admin-only), nenhum GRANT de INSERT/UPDATE/DELETE
-- para `authenticated` — a única porta de escrita será uma function
-- security definer futura (mesmo padrão de `log_admin_action`), quando o
-- primeiro produtor real de eventos existir (webhook ou RPC administrativa
-- de cancelamento/reativação — nenhum dos dois nesta etapa).
-- ============================================================================

create table public.subscription_events (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.subscriptions (id) on delete cascade,
  from_status      text,
  to_status        text not null,
  source           text not null check (source in ('webhook', 'admin', 'reconciliation')),
  stripe_event_id  text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

comment on table public.subscription_events is
  'Etapa 15.7 — log append-only de toda transição de estado de subscriptions (com ou sem ator humano). Imutável: sem policy de update/delete, sem GRANT de insert para authenticated — escrita só via function security definer futura.';

create index idx_subscription_events_subscription_id on public.subscription_events (subscription_id);
create index idx_subscription_events_created_at on public.subscription_events (created_at desc);

alter table public.subscription_events enable row level security;

create policy "subscription_events_select_admin"
  on public.subscription_events
  for select
  using (public.is_platform_admin());

-- Nenhum GRANT de INSERT/UPDATE/DELETE para authenticated nesta tabela —
-- mesmo padrão de admin_audit_logs. A porta de escrita (function security
-- definer) fica para quando o primeiro produtor real existir.
revoke insert, update, delete on public.subscription_events from authenticated;
