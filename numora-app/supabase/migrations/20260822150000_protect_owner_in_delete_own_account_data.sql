-- ============================================================================
-- Etapa 15.10.17B — defesa em profundidade: bloqueia a exclusão do `owner`
-- também DENTRO da RPC `delete_own_account_data`, não só no Route Handler
-- que a chama.
--
-- NÃO edita a migration `20260822140100_create_delete_own_account_data_rpc.sql`
-- (já aplicada ao banco real) — esta é uma migration incremental separada,
-- via `CREATE OR REPLACE FUNCTION` (mesmo padrão já usado em todo o projeto
-- para revisar uma função existente, ex.: `20260815192327_add_soft_delete_
-- to_collection_items.sql` reescrevendo `get_public_passport`). `REVOKE`/
-- `GRANT`/`COMMENT` da migration anterior persistem — `CREATE OR REPLACE`
-- não os reseta, então não precisam ser repetidos aqui.
--
-- Por que a checagem é `SELECT role FROM profiles WHERE id = p_user_id`, e
-- NÃO `is_platform_owner()`: essa função depende de `auth.uid()` (só
-- funciona na sessão do próprio usuário) e seu `EXECUTE` é concedido só a
-- `authenticated` — nenhum dos dois é verdade no caminho real desta RPC
-- (chamada pelo `service_role`, sem JWT de usuário). A checagem aqui lê a
-- mesma coluna (`profiles.role`), só de forma parametrizada em vez de via
-- sessão — mesma fonte de verdade, sem depender de auth.uid() nem duplicar
-- a definição de "o que é owner" em dois lugares divergentes.
-- ============================================================================

create or replace function public.delete_own_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_role text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Não é permitido excluir dados de outro usuário.' using errcode = '42501';
  end if;

  select role into v_target_role from public.profiles where id = p_user_id;

  if v_target_role = 'owner' then
    raise exception 'A conta do proprietário da plataforma não pode ser excluída por este fluxo.' using errcode = '42501';
  end if;

  delete from public.profiles where id = p_user_id;
end;
$$;

comment on function public.delete_own_account_data(uuid) is
  'Etapa 15.10.17A/B — remove profile + todo dado dependente via cascade do Postgres. Bloqueia role=owner (defesa em profundidade, além do Route Handler). NÃO toca em auth.users nem em Storage. EXECUTE só para service_role.';
