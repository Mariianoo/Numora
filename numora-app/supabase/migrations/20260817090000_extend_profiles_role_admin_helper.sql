-- ============================================================================
-- Etapa 15.3 (Admin Control Center) — fundação de autorização administrativa.
--
-- `profiles.role` já existia desde `extend_profiles_columns`
-- ('user'/'seller'/'admin', protegido por GRANT column-level — só o banco
-- pode alterá-lo, nunca o próprio usuário). Esta migration REUTILIZA esse
-- campo (não cria um novo) e só amplia o CHECK para acomodar os níveis
-- administrativos hierárquicos pedidos nesta etapa: 'owner' e os dois
-- reservados para o futuro ('support'/'finance'). 'seller' é preservado —
-- é um eixo ortogonal (papel de marketplace), não um nível administrativo,
-- e removê-lo seria uma alteração fora do escopo desta etapa.
--
-- Nesta etapa, apenas 'owner' e 'admin' concedem acesso administrativo real
-- (`is_platform_admin()` abaixo). 'support'/'finance' já existem como
-- valores válidos no banco, mas ainda são tratados como sem acesso — a
-- granularidade de permissão por esses papéis fica para uma etapa futura,
-- conforme pedido explicitamente ("NÃO colocar permissões complexas ainda").
-- ============================================================================

alter table public.profiles
  drop constraint chk_profiles_role;

alter table public.profiles
  add constraint chk_profiles_role
  check (role in ('user', 'seller', 'admin', 'owner', 'support', 'finance'));

-- ----------------------------------------------------------------------------
-- Helper de autorização — usado por TODA policy/RPC administrativa desta
-- etapa em diante. `security definer` + `search_path` fixo (mesmo padrão já
-- usado em `handle_new_user`/`assign_numora_id`): a função roda com os
-- privilégios do dono (bypassa a RLS de `profiles` internamente), então o
-- SELECT abaixo nunca depende da policy `profiles_select_own` para
-- funcionar — evita qualquer risco de recursão de RLS entre esta função e
-- as policies que a chamam. `stable` (não `volatile`): dentro de um mesmo
-- statement o resultado não muda, permitindo ao planner reutilizar o valor
-- em vez de reavaliar por linha — mesma motivação de performance do padrão
-- `(select auth.uid())` já adotado no projeto.
-- ============================================================================
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

comment on function public.is_platform_admin() is
  'Etapa 15.3 — true quando o usuário autenticado tem role owner/admin. Único mecanismo de autorização administrativa: nunca checar e-mail hardcoded, nunca confiar em app_metadata do JWT (não populado hoje).';

-- ----------------------------------------------------------------------------
-- `profiles_select_own` (já existente) continua intocada — esta é uma
-- policy ADICIONAL (RLS combina múltiplas policies permissivas com OR),
-- então o acesso "cada usuário só lê a própria linha" não muda em nada
-- para usuários comuns. Administradores passam a também poder ler
-- qualquer linha — necessário para a tela /admin/members existir.
-- ============================================================================
create policy "profiles_select_admin"
  on public.profiles
  for select
  using (public.is_platform_admin());

comment on policy "profiles_select_admin" on public.profiles is
  'Etapa 15.3 — leitura administrativa de todos os perfis. Aditiva a profiles_select_own, nunca a substitui.';
