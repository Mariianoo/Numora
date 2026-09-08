-- ============================================================================
-- Etapa "Stripe 5.1 — Subscription schema hardening" — impede que um mesmo
-- usuário tenha mais de uma subscription simultaneamente num estado que
-- `effective_plans()` já trata como "concede acesso"
-- (`20260817110700_create_effective_plan.sql`/reescrita posterior:
-- `status in ('trialing', 'active', 'past_due')`).
--
-- O conjunto usado aqui é DELIBERADAMENTE idêntico ao filtro já existente
-- em `effective_plans()` — nenhuma política nova é inventada. Estados não
-- incluídos (canceled, incomplete, incomplete_expired, unpaid, paused) já
-- são tratados como "não concede acesso" pelo entitlement e, pela mesma
-- razão, nunca ocupam a vaga aqui: um usuário com uma subscription
-- `canceled`/`incomplete`/etc. pode sempre iniciar uma nova.
--
-- `subscriptions` está vazia em DEV (confirmado antes desta migration) —
-- nenhum dado existente para migrar/violar.
-- ============================================================================

create unique index uq_subscriptions_user_id_active_status
  on public.subscriptions (user_id)
  where status in ('trialing', 'active', 'past_due');

comment on index public.uq_subscriptions_user_id_active_status is
  'Etapa "Stripe 5.1" — no máximo uma subscription por usuário nos estados que effective_plans() trata como "concede acesso" (trialing/active/past_due). Mesmo conjunto de effective_plans(), de propósito — nunca uma política de elegibilidade diferente.';
