-- ============================================================================
-- Etapa "5.9G — First-Party Analytics Outbox" — infraestrutura de entrega
-- confiável para eventos de analytics nascidos SERVER-SIDE (hoje, só
-- `checkout_completed`, a partir do webhook Stripe já verificado). Nenhum
-- vendor externo é chamado nesta etapa — esta tabela existe para que o
-- funil possa ser medido internamente (e futuramente entregue a um vendor
-- ainda não escolhido) sem jamais acoplar a disponibilidade de um serviço
-- de analytics à janela de resposta do webhook do Stripe.
--
-- Dedicada a UM propósito (delivery de eventos server-side de analytics) —
-- de propósito, NÃO um "sistema de eventos genérico". Não reaproveita
-- `billing_webhook_events`: aquela tabela tem seu próprio ciclo de vida
-- (correção do processamento de billing por `stripe_event_id`), um
-- conceito diferente de "este evento de analytics foi entregue a um
-- vendor" — conflar os dois acoplaria dois domínios independentes numa
-- única tabela/linha (auditoria "5.9F Decision Audit", seção OUTBOX
-- ANALYSIS).
--
-- Mesmo padrão de segurança de `billing_webhook_events` (Etapa 15.7): RLS
-- habilitada + ZERO policies + REVOKE explícito = negação total para
-- `authenticated`/`anon` via PostgREST. Só o handler do webhook (service
-- role, que sempre ignora RLS) escreve aqui — nenhum usuário autenticado
-- pode inserir, alterar ou ler uma linha, inclusive a própria (não é dado
-- do usuário, é telemetria interna de produto).
--
-- IDEMPOTÊNCIA: `UNIQUE(source_reference, event_name)` — nunca só
-- `stripe_event_id` (auditoria "5.9F Decision Audit" §15: eventos Stripe
-- DIFERENTES — checkout.session.completed / invoice.paid /
-- subscription.created — têm `stripe_event_id` diferentes entre si, então
-- uma constraint por `stripe_event_id` não impediria múltiplas linhas para
-- o MESMO checkout via tipos de evento distintos). `source_reference`
-- (o Stripe Checkout Session ID, nunca exposto fora deste banco) é o
-- objeto que só pode gerar `checkout.session.completed` UMA vez —
-- combinado com `event_name`, garante "um Checkout bem-sucedido → no
-- máximo uma linha `checkout_completed`", mesmo sob reprocessamento do
-- mesmo webhook Stripe (ou, em tese, de um futuro segundo tipo de evento
-- server-side que também usasse este outbox).
--
-- `source_reference` existe SÓ para correlação/idempotência/debug
-- interno — nunca deve aparecer num payload de analytics externo, no
-- client, ou em qualquer API pública (ver `lib/stripe/analytics-outbox.ts`).
--
-- `trigger`/`plan_slug`/`interval`/`currency` são nullable de propósito:
-- só `checkout_completed` existe hoje e populamos o que já está disponível
-- via `metadata` da Checkout Session (Etapa 5.9G) — `trigger` ainda não
-- tem um canal client→servidor autorizado para chegar até aqui (só o
-- booleano de consentimento foi autorizado nesta etapa), então fica `null`
-- até uma etapa futura decidir propagá-lo.
--
-- `consent_snapshot` é sempre um valor explícito (nunca nulo, nunca
-- assumido `true`) — reflete o `consent.analytics` do browser no momento
-- em que o Checkout foi INICIADO (nunca revisitado depois), lido de
-- `metadata.numora_analytics_consent` da Checkout Session.
--
-- Nenhum forwarder para um vendor externo existe nesta etapa — por isso
-- toda linha nova nasce `status = 'pending'` e nenhum código marca
-- `delivered` (não haveria entrega real para justificar esse status
-- ainda). `abandoned` existe para um futuro forwarder desistir após
-- esgotar tentativas, sem precisar de uma migration nova só para isso.
-- ============================================================================

create table public.analytics_outbox (
  id                uuid primary key default gen_random_uuid(),
  funnel_id         uuid not null,
  event_name        text not null check (event_name in ('checkout_completed')),
  trigger           text,
  plan_slug         text,
  interval          text,
  currency          text,
  consent_snapshot  boolean not null,
  source_reference  text not null,
  status            text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'abandoned')),
  attempts          integer not null default 0,
  available_at      timestamptz not null default now(),
  last_error        text,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz,
  constraint uq_analytics_outbox_source_reference_event_name unique (source_reference, event_name)
);

comment on table public.analytics_outbox is
  'Etapa 5.9G — outbox first-party para eventos de analytics server-side (hoje, só checkout_completed). Nenhum vendor externo é chamado a partir daqui nesta etapa. source_reference (Stripe Checkout Session ID) é só para correlação/idempotência interna — nunca sai para fora deste banco. Sem NENHUMA policy para authenticated — só acessível ao webhook handler (service role).';

comment on column public.analytics_outbox.funnel_id is
  'UUID gerado pelo servidor no momento da criação do Checkout (nunca derivado de user_id/Stripe IDs) — o único identificador que um futuro forwarder pode enviar a um vendor externo.';

comment on column public.analytics_outbox.source_reference is
  'Stripe Checkout Session ID — exclusivamente para correlação/idempotência/debug interno. NUNCA deve aparecer em payload de analytics externo, resposta de API pública, ou no client.';

comment on column public.analytics_outbox.consent_snapshot is
  'consent.analytics do browser no momento em que o Checkout foi iniciado (metadata.numora_analytics_consent da Checkout Session) — nunca reescrito por decisão de consentimento posterior.';

create index idx_analytics_outbox_status on public.analytics_outbox (status);
create index idx_analytics_outbox_funnel_id on public.analytics_outbox (funnel_id);

alter table public.analytics_outbox enable row level security;

-- Nenhuma policy criada de propósito — RLS habilitada + zero policies =
-- negação total para `authenticated`/`anon` via PostgREST. Reforçado com
-- REVOKE explícito (mesmo padrão de billing_webhook_events).
revoke all on public.analytics_outbox from authenticated, anon;
