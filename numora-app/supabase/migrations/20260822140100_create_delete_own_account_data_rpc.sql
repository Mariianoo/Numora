-- ============================================================================
-- Etapa 15.10.17A (Fundação de exclusão de conta) — RPC que remove, numa
-- única transação, todos os dados de um usuário no Postgres que dependem
-- de `profiles.id`. NÃO toca em `auth.users` (isso é da futura Etapa
-- 15.10.17B, via Admin API, que só o servidor com service_role pode
-- chamar) e NÃO toca em Storage (idem — Etapa 15.10.17B).
--
-- DESENHO: um único `DELETE FROM public.profiles WHERE id = p_user_id`.
-- Auditoria do catálogo real (`pg_constraint`, antes desta migration)
-- confirmou que TODA tabela com dado de usuário já tem
-- `ON DELETE CASCADE` a partir de `profiles(id)`, direta ou
-- transitivamente: collection_items → collection_units → coin_images;
-- collection_items → sales (e sales.user_id também); purchases;
-- user_acquisition; billing_customers → subscriptions;
-- billing_transactions; benefit_grants (via user_id, o beneficiário).
-- As 2 únicas exceções (`admin_audit_logs.actor_user_id`,
-- `benefit_grants.created_by`, ambas `RESTRICT`) foram corrigidas para
-- `SET NULL` na migration anterior desta mesma etapa. Deixar o Postgres
-- resolver o cascade (em vez de um DELETE manual por tabela) é mais
-- seguro: a ordem correta é garantida pelo próprio motor de integridade
-- referencial, não por uma lista mantida à mão que pode ficar
-- desatualizada se o schema mudar.
--
-- SEGURANÇA (defesa em profundidade):
-- 1) Camada real: EXECUTE é revogado de `public`/`anon`/`authenticated` e
--    concedido SOMENTE a `service_role` (abaixo) — nenhum usuário comum,
--    mesmo autenticado, consegue sequer chamar esta função via
--    PostgREST/`.rpc()`. A futura Etapa 15.10.17B é quem vai chamá-la, a
--    partir de um Route Handler server-side usando a service role key
--    (nunca exposta ao client).
-- 2) Camada defensiva: se por algum motivo a função for executada num
--    contexto que carregue um JWT de usuário comum (`auth.uid()` não
--    nulo — não deveria ser alcançável dado (1)), exige que `p_user_id`
--    seja exatamente o próprio usuário. Nunca confia cegamente no
--    parâmetro recebido.
--
-- `search_path` fixado (mesmo padrão de toda função SECURITY DEFINER já
-- existente no projeto — `is_platform_admin`, `is_platform_owner`,
-- `get_public_passport`, `log_admin_action`).
-- ============================================================================

create or replace function public.delete_own_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Não é permitido excluir dados de outro usuário.' using errcode = '42501';
  end if;

  -- Idempotente: se `p_user_id` já não existir em `profiles` (chamada
  -- repetida, ou execução parcial anterior que já concluiu este passo),
  -- este DELETE afeta 0 linhas e retorna normalmente — nunca é um erro.
  delete from public.profiles where id = p_user_id;
end;
$$;

revoke all on function public.delete_own_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_own_account_data(uuid) to service_role;

comment on function public.delete_own_account_data(uuid) is
  'Etapa 15.10.17A — remove profile + todo dado dependente (coleção, exemplares, fotos [metadados], compras, vendas, atribuição, assinaturas) via cascade do Postgres. NÃO toca em auth.users nem em Storage (Etapa 15.10.17B). EXECUTE só para service_role — nunca chamável por um usuário comum via PostgREST.';
