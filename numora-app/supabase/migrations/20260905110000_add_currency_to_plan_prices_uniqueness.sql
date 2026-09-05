-- ============================================================================
-- Etapa "Stripe 1 — Correção multimoeda do plan_prices".
--
-- A constraint `uq_plan_prices_plan_interval` (UNIQUE(plan_id, interval),
-- criada em `20260817110100_create_plan_prices.sql`) foi desenhada para "um
-- preço por plano×intervalo", sem prever multi-moeda — impede, por
-- exemplo, que "Pro mensal BRL" e "Pro mensal USD" coexistam (achado da
-- auditoria "Stripe 0"). O modelo de negócio aprovado precisa de preços
-- distintos por país/moeda para o mesmo plano×intervalo.
--
-- Troca cirúrgica: substitui a UNIQUE(plan_id, interval) por
-- UNIQUE(plan_id, interval, currency). Nenhuma outra coluna, FK, CHECK,
-- índice, RLS, policy ou GRANT desta tabela é tocado — só a constraint de
-- unicidade muda de forma. Tabela vazia em DEV/Production (confirmado
-- antes desta migration) — nenhum dado existente para migrar/conflitar.
-- ============================================================================

alter table public.plan_prices
  drop constraint uq_plan_prices_plan_interval;

alter table public.plan_prices
  add constraint uq_plan_prices_plan_interval_currency unique (plan_id, "interval", currency);

comment on constraint uq_plan_prices_plan_interval_currency on public.plan_prices is
  'Etapa "Stripe 1" — um preço ativo por combinação (plano, intervalo, moeda). Substitui uq_plan_prices_plan_interval (que não previa multi-moeda).';
