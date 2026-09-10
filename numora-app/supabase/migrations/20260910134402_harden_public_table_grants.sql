-- ============================================================================
-- Etapa "5.9M-C — Database Grants Hardening" — reduz privilégios PostgreSQL
-- excessivos concedidos historicamente a `anon`/`authenticated` em todas as
-- tabelas de `public`, sem alterar RLS (policies continuam sendo a camada
-- principal de autorização; GRANTs passam a ser só a segunda camada de
-- defesa em profundidade — nenhuma policy é criada/alterada/removida aqui).
--
-- Evidência completa: auditorias read-only 5.9M-A (inventário + matriz de
-- privilégios) e 5.9M-B (resolução dos UNKNOWNs: sales, plan_entitlements,
-- billing_customers, subscriptions, plans, plan_prices) — cada REVOKE abaixo
-- corresponde a um item classificado "SAFE TO REVOKE NOW" nessas auditorias.
--
-- O QUE NÃO É TOCADO NESTA MIGRATION (decisão explícita, não descuido):
--   - billing_customers: nenhum privilégio revogado (policies owner/admin
--     sugerem uma tela administrativa futura ainda não construída —
--     aguardando confirmação do OWNER, 5.9M-B).
--   - plan_prices: INSERT/UPDATE/DELETE preservados (recordStripePriceSync/
--     activateSyncedPrice existem no código sem caller de produto ainda —
--     possível infraestrutura de sincronização futura, 5.9M-B). SELECT
--     preservado (uso real confirmado no catálogo de checkout).
--   - sales: CRUD de `authenticated` preservado — schema/policies prontos
--     para uma feature futura, decisão de remover fica para outra etapa.
--   - plans/subscriptions: SELECT de `authenticated` preservado (uso real
--     confirmado no dashboard administrativo, admin_dashboard_metrics/
--     admin_plan_distribution).
--   - service_role/postgres: nenhum privilégio alterado em nenhuma tabela.
--   - Nenhuma função, trigger, view ou policy é alterada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOCO A — revoga TODOS os privilégios de `anon` nas 25 tabelas de `public`.
-- Nenhum caminho funcional real usa `anon` diretamente em nenhuma delas — o
-- único acesso público legítimo (Passport) passa por RPC SECURITY DEFINER
-- (get_public_passport/get_public_passport_item/list_public_passports), que
-- roda com os privilégios do dono da função, nunca dependendo do grant de
-- tabela do caller. `analytics_outbox`/`billing_webhook_events` já não têm
-- nenhum grant para `anon` (revogado em etapas anteriores) — os REVOKEs
-- abaixo são no-ops seguros para essas duas, incluídos só por consistência
-- determinística com as outras 23.
-- ----------------------------------------------------------------------------

revoke all on table public.admin_audit_logs from anon;
revoke all on table public.analytics_outbox from anon;
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

-- ----------------------------------------------------------------------------
-- BLOCO B — revoga TRUNCATE de `authenticated` nas 25 tabelas. TRUNCATE nunca
-- é verificado por policies de RLS (é uma operação de nível de tabela, não de
-- linha) e não é um verbo exposto pelo PostgREST/Supabase client — nenhum
-- caminho de aplicação, RPC ou trigger o utiliza em nenhuma tabela.
-- SELECT/INSERT/UPDATE/DELETE de `authenticated` NÃO são tocados neste bloco.
-- ----------------------------------------------------------------------------

revoke truncate on table public.admin_audit_logs from authenticated;
revoke truncate on table public.analytics_outbox from authenticated;
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

-- ----------------------------------------------------------------------------
-- BLOCO C — revogações cirúrgicas de `authenticated` confirmadas pela
-- auditoria 5.9M-A/5.9M-B: privilégios de tabela para os quais NENHUMA
-- policy de RLS permite a operação a nenhum usuário comum, ou para os quais
-- nenhum consumidor de código foi encontrado (todo acesso real acontece via
-- RPC SECURITY DEFINER + service_role, ou não existe).
--
-- profiles: criação é só via trigger (handle_new_user), exclusão só via
--   delete_own_account_data() RPC + service_role — nenhuma policy de
--   INSERT/DELETE existe para authenticated.
-- feedbacks: nenhuma policy de DELETE existe (insert/select own,
--   select/update admin apenas).
-- user_acquisition: nenhuma policy de UPDATE existe (insert/select own,
--   select admin, owner delete apenas).
-- admin_audit_logs/billing_transactions/subscription_events: só existe
--   policy de SELECT admin; toda escrita real é via
--   log_admin_action()/sync_billing_transaction_from_invoice()/
--   sync_subscription_from_stripe() (SECURITY DEFINER) + service_role.
-- countries/grades/metals: tabelas de referência/seed; nenhuma policy de
--   escrita existe para nenhuma role — grants de escrita nunca foram
--   utilizáveis.
-- plan_entitlements: nenhum `.from('plan_entitlements')` existe em código
--   de produto — todo acesso real é via get_entitlement()/
--   get_my_entitlement() (SECURITY DEFINER), tornando o SELECT direto de
--   `authenticated` redundante.
-- plans/subscriptions: SELECT preservado (uso real confirmado no dashboard
--   administrativo); nenhum INSERT/UPDATE/DELETE via `authenticated` foi
--   encontrado em nenhuma tela/repository — toda escrita real usa
--   service_role.
-- ----------------------------------------------------------------------------

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
