-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — ledger de idempotência para webhooks
-- Stripe futuros.
--
-- Esta migration APENAS prepara a estrutura — nenhum endpoint de webhook
-- existe nesta etapa (fora de escopo, Etapa 15.7 §9), e nenhuma Service
-- Role Key foi criada/usada. Por isso a tabela nasce SEM NENHUMA policy de
-- RLS para `authenticated` (nem leitura, nem escrita — nem para
-- owner/admin): "nenhuma escrita/leitura pública para authenticated"
-- (Etapa 15.7 §"BILLING WEBHOOK EVENTS"), reforçado com REVOKE explícito.
-- Ficará acessível apenas ao futuro handler server-side (via service role,
-- que bypassa RLS) quando a Fase B (Etapa 15.6 §19) for implementada — uma
-- policy de leitura administrativa (para uma tela de debug) pode ser
-- adicionada nessa etapa futura, não nesta.
--
-- UNIQUE(stripe_event_id) é a própria idempotência: um handler futuro
-- insere aqui ANTES de processar qualquer efeito colateral; conflito =
-- evento já visto, curto-circuita sem reprocessar.
-- ============================================================================

create table public.billing_webhook_events (
  id               uuid primary key default gen_random_uuid(),
  stripe_event_id  text not null,
  type             text not null,
  payload          jsonb not null,
  status           text not null default 'received' check (status in ('received', 'processed', 'failed')),
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  error            text,
  constraint uq_billing_webhook_events_stripe_event_id unique (stripe_event_id)
);

comment on table public.billing_webhook_events is
  'Etapa 15.7 — ledger de idempotência para webhooks Stripe (endpoint ainda não existe, fora de escopo). UNIQUE(stripe_event_id) é o mecanismo de idempotência. Sem NENHUMA policy para authenticated — só acessível a um handler server-side futuro (service role).';

create index idx_billing_webhook_events_status on public.billing_webhook_events (status);

alter table public.billing_webhook_events enable row level security;

-- Nenhuma policy criada de propósito — RLS habilitada + zero policies =
-- negação total para `authenticated`/`anon` via PostgREST. Reforçado com
-- REVOKE explícito (mesmo padrão de defesa em profundidade já usado em
-- admin_audit_logs).
revoke all on public.billing_webhook_events from authenticated, anon;
