-- ============================================================================
-- Etapa "5.9P — Production Grants Hardening" — versão Production-specific
-- da migration DEV `20260910134402_harden_public_table_grants.sql` (5.9M-C),
-- adaptada ao schema REAL de Production (24 tabelas — sem `analytics_outbox`,
-- que ainda não existe lá; sem `coins`, já removida na Etapa 5.9O).
--
-- APLICAÇÃO NESTA ETAPA (5.9P-IMPLEMENTATION): SOMENTE em DEV
-- (sfhnhgkicvtvhbwpttwh), como ensaio/validação controlada do conteúdo
-- exato que será usado em Production numa etapa futura separada. DEV já
-- passou pela migration mais ampla de 25 tabelas (5.9M-C,
-- `20260910134402_harden_public_table_grants.sql`), então todo REVOKE
-- abaixo já é um no-op seguro em DEV hoje — o objetivo aqui é validar que o
-- SQL Production-specific roda sem erro e que a suíte de testes completa
-- continua passando, nunca alterar o estado de privilégios do DEV (que já
-- está correto desde o 5.9M-C).
--
-- Mesma lógica, mesma evidência (5.9M-A/5.9M-B/5.9P), RLS continua sendo a
-- camada principal de autorização — GRANTs são só defesa em profundidade.
-- Nenhuma policy, função, trigger ou dado é alterado.
-- ============================================================================

-- BLOCO A — revoga TODOS os privilégios de anon nas 24 tabelas do schema
-- Production (analytics_outbox deliberadamente ausente desta lista).
revoke all on table public.admin_audit_logs from anon;
revoke all on table public.benefit_grants from anon;
revoke all on table public.billing_customers from anon;
revoke all on table public.billing_transactions from anon;
revoke all on table public.billing_webhook_events from anon;
revoke all on table public.coin_images from anon;
revoke all on table public.collection_item_coin_part_components from anon;
revoke all on table public.collection_item_coin_parts from anon;
revoke all on table public.collection_items from anon;
revoke all on table public.collection_units from anon;
revoke all on table public.countries from anon;
revoke all on table public.feedback_admin_notes from anon;
revoke all on table public.feedbacks from anon;
revoke all on table public.grades from anon;
revoke all on table public.metals from anon;
revoke all on table public.plan_entitlements from anon;
revoke all on table public.plan_prices from anon;
revoke all on table public.plans from anon;
revoke all on table public.profiles from anon;
revoke all on table public.purchases from anon;
revoke all on table public.sales from anon;
revoke all on table public.subscription_events from anon;
revoke all on table public.subscriptions from anon;
revoke all on table public.user_acquisition from anon;

-- BLOCO B — revoga TRUNCATE de authenticated nas mesmas 24 tabelas.
revoke truncate on table public.admin_audit_logs from authenticated;
revoke truncate on table public.benefit_grants from authenticated;
revoke truncate on table public.billing_customers from authenticated;
revoke truncate on table public.billing_transactions from authenticated;
revoke truncate on table public.billing_webhook_events from authenticated;
revoke truncate on table public.coin_images from authenticated;
revoke truncate on table public.collection_item_coin_part_components from authenticated;
revoke truncate on table public.collection_item_coin_parts from authenticated;
revoke truncate on table public.collection_items from authenticated;
revoke truncate on table public.collection_units from authenticated;
revoke truncate on table public.countries from authenticated;
revoke truncate on table public.feedback_admin_notes from authenticated;
revoke truncate on table public.feedbacks from authenticated;
revoke truncate on table public.grades from authenticated;
revoke truncate on table public.metals from authenticated;
revoke truncate on table public.plan_entitlements from authenticated;
revoke truncate on table public.plan_prices from authenticated;
revoke truncate on table public.plans from authenticated;
revoke truncate on table public.profiles from authenticated;
revoke truncate on table public.purchases from authenticated;
revoke truncate on table public.sales from authenticated;
revoke truncate on table public.subscription_events from authenticated;
revoke truncate on table public.subscriptions from authenticated;
revoke truncate on table public.user_acquisition from authenticated;

-- BLOCO C — revogações cirúrgicas de authenticated (mesma matriz aprovada
-- em 5.9M-A/5.9M-B/5.9P — nenhuma policy de RLS permite a operação a
-- nenhum usuário comum, ou nenhum consumidor de código foi encontrado).
revoke insert on table public.profiles from authenticated;
revoke delete on table public.profiles from authenticated;

revoke delete on table public.feedbacks from authenticated;

revoke update on table public.user_acquisition from authenticated;

revoke insert on table public.admin_audit_logs from authenticated;
revoke update on table public.admin_audit_logs from authenticated;
revoke delete on table public.admin_audit_logs from authenticated;

revoke insert on table public.billing_transactions from authenticated;
revoke update on table public.billing_transactions from authenticated;
revoke delete on table public.billing_transactions from authenticated;

revoke insert on table public.subscription_events from authenticated;
revoke update on table public.subscription_events from authenticated;
revoke delete on table public.subscription_events from authenticated;

revoke insert on table public.countries from authenticated;
revoke update on table public.countries from authenticated;
revoke delete on table public.countries from authenticated;

revoke insert on table public.grades from authenticated;
revoke update on table public.grades from authenticated;
revoke delete on table public.grades from authenticated;

revoke insert on table public.metals from authenticated;
revoke update on table public.metals from authenticated;
revoke delete on table public.metals from authenticated;

revoke select on table public.plan_entitlements from authenticated;

revoke insert on table public.plans from authenticated;
revoke update on table public.plans from authenticated;
revoke delete on table public.plans from authenticated;

revoke insert on table public.subscriptions from authenticated;
revoke update on table public.subscriptions from authenticated;
revoke delete on table public.subscriptions from authenticated;
