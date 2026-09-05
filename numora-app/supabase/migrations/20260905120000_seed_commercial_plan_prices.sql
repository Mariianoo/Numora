-- ============================================================================
-- Etapa "Stripe 3 — Catálogo comercial no banco".
--
-- Duas mudanças, ambas aditivas, nada removido/alterado do que já existe:
--
-- 1) CHECK de currency — `plan_prices.currency` (char(3), já existente)
--    nunca teve nenhuma restrição de valores (achado da Stripe 2). V1
--    suporta somente BRL/USD (decisão de negócio já aprovada — Stripe 0/2).
--    Nome segue o padrão `chk_<tabela>_<coluna>` já usado no projeto
--    (`chk_plans_billing_interval`, `chk_plan_entitlements_limit_value`,
--    `chk_subscriptions_period`, `chk_benefit_grants_expires_after_starts`).
--
-- 2) Seed dos 8 preços comerciais aprovados (Pro/Premium × month/year ×
--    BRL/USD — Free não tem nenhuma linha, não tem cobrança Stripe).
--    `plan_id` resolvido por `slug` via subquery, nunca um UUID hardcoded
--    (mesmo padrão de `20260817140300_seed_plan_entitlements.sql`).
--    `stripe_price_id = NULL` e `active = false` em todas as 8 linhas —
--    nenhum Stripe Price existe ainda (Stripe 4, etapa futura, cria os
--    Products/Prices reais e faz o back-fill destes 2 campos).
--
-- Tabela confirmada com 0 linhas em DEV antes desta migration — nenhum
-- dado existente para conflitar. A UNIQUE(plan_id, interval, currency)
-- (Stripe 1) já garante que, se por algum motivo esta migration rodasse
-- mais de uma vez, o INSERT falharia por violação de unicidade em vez de
-- duplicar ou sobrescrever silenciosamente qualquer linha.
-- ============================================================================

alter table public.plan_prices
  add constraint chk_plan_prices_currency check (currency in ('BRL', 'USD'));

insert into public.plan_prices (plan_id, "interval", amount, currency, active, stripe_price_id)
select p.id, v.interval, v.amount, v.currency, false, null
from public.plans p
join (
  values
    ('pro',     'month', 19.90,  'BRL'),
    ('pro',     'year',  199.00, 'BRL'),
    ('pro',     'month', 5.99,   'USD'),
    ('pro',     'year',  59.00,  'USD'),
    ('premium', 'month', 34.90,  'BRL'),
    ('premium', 'year',  349.00, 'BRL'),
    ('premium', 'month', 9.99,   'USD'),
    ('premium', 'year',  99.00,  'USD')
) as v(plan_slug, "interval", amount, currency)
  on v.plan_slug = p.slug
where p.slug in ('pro', 'premium');
