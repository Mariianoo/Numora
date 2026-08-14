-- ============================================================================
-- Fase 1, Etapa 9.1 — corrige um desvio do padrão de grants do projeto.
-- `collection_items`/`collection_units` (e as tabelas de referência)
-- deliberadamente concedem grants de tabela a `anon` E `authenticated`,
-- deixando a RLS como único portão real — padrão consciente do projeto.
-- `coin_images` é diferente: fotos privadas de exemplar não têm nenhum
-- caso de uso anônimo (ao contrário do Passport, que é público por
-- design via RPC dedicada), então aqui o acesso de `anon` foi revogado
-- por completo — defesa em profundidade, não dependendo só da RLS.
--
-- Reconstruída nesta auditoria (Etapa 10) a partir do estado real do
-- banco — arquivo original nunca foi commitado no repositório. Confirmado
-- via information_schema.role_table_grants que `anon` hoje não possui
-- NENHUM privilégio (SELECT/INSERT/UPDATE/DELETE/TRIGGER/TRUNCATE/
-- REFERENCES) em `coin_images` — só `authenticated`.
-- ============================================================================

revoke all on table public.coin_images from anon;
