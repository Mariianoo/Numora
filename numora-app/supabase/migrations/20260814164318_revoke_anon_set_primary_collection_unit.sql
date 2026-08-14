-- ============================================================================
-- Etapa 10 — mesmo padrão já corrigido para coin_images (Etapa 9.1):
-- funções novas recebem grant automático de EXECUTE para anon via
-- default privileges do Supabase, independente do `revoke all ... from
-- public` na migration anterior. Esta RPC só deve ser chamável por
-- usuários autenticados.
--
-- Registrada nesta auditoria de rastreabilidade a partir do texto
-- exatamente aplicado via `apply_migration` nesta mesma sessão.
-- ============================================================================

revoke execute on function public.set_primary_collection_unit(uuid) from anon;
