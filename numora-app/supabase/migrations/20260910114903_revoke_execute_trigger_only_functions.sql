-- ============================================================================
-- Etapa "5.9K — Security Hardening" (item 2) — fecha o único desvio
-- remanescente da convenção já estabelecida no projeto: toda função cujo
-- uso esperado é EXCLUSIVAMENTE via trigger (nunca chamada direta via
-- RPC/PostgREST) deve ter EXECUTE revogado de `anon`/`authenticated`
-- (e de `public`, para nunca depender do default de "GRANT EXECUTE TO
-- PUBLIC" que o Postgres aplica na criação da função) — mesmo padrão já
-- usado por `enforce_transaction_user_matches_subscription`,
-- `enforce_collection_item_restore_limit`, `set_updated_at`, e outras
-- ~15 funções trigger-only deste schema.
--
-- As 3 funções abaixo eram exceções (auditoria "5.9K Security Hardening
-- Audit", Fase 1): continuavam com EXECUTE concedido a `anon`/`authenticated`
-- mesmo sendo usadas só por trigger. Risco funcional real: nenhum — chamar
-- qualquer uma delas fora de um contexto de trigger falha (referenciam
-- NEW/OLD, que só existem dentro de um trigger), mas o GRANT solto viola
-- o princípio de menor privilégio e é sinalizado pelo linter de segurança
-- do Postgres/Supabase (`anon_security_definer_function_executable`/
-- `authenticated_security_definer_function_executable`).
--
-- Revogar EXECUTE nunca afeta a capacidade do trigger de disparar: o
-- mecanismo de trigger do Postgres invoca a função com os privilégios do
-- dono da tabela/definer, não checa o EXECUTE do papel que originou o
-- DML — mesmo comportamento já comprovado pelas ~15 funções trigger-only
-- já revogadas neste schema (todos os triggers correspondentes continuam
-- funcionando normalmente, testes de integração já provam isso).
--
-- `promote_primary_after_unit_delete()` é SECURITY INVOKER (não DEFINER)
-- — inclusa aqui só por consistência de convenção, não por risco de
-- escalação de privilégio (que não existe numa função INVOKER).
--
-- Nenhum corpo de função, trigger, RLS, ou outra função é alterado nesta
-- migration.
-- ============================================================================

revoke execute on function public.check_collection_unit_not_last() from public, anon, authenticated;
revoke execute on function public.sync_collection_item_quantity() from public, anon, authenticated;
revoke execute on function public.promote_primary_after_unit_delete() from public, anon, authenticated;
