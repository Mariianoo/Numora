-- ============================================================================
-- Etapa 15.7 (Billing Foundation) — segundo nível de autorização administrativa.
--
-- Mesmo padrão de `is_platform_admin()` (Etapa 15.3): `security definer` +
-- `stable` + `search_path` fixo, nunca checa e-mail/username hardcoded,
-- nunca confia em `app_metadata` do JWT — sempre `auth.uid()` →
-- `profiles.role`. Diferente de `is_platform_admin()` (aceita
-- 'owner'/'admin'), esta função só retorna true para `role = 'owner'`
-- exatamente — usada pelas policies/RPCs de billing que devem ser
-- exclusivas do proprietário da plataforma (Etapa 15.6 §8/§22): billing
-- financeiro, alteração de plano, cancelamento administrativo,
-- configurações comerciais.
--
-- `is_platform_admin()` permanece INALTERADA — nenhuma adaptação foi
-- necessária. Owner continua sendo aceito por `is_platform_admin()`
-- também (owner ⊂ admin para fins de acesso operacional, mas não o
-- contrário: admin comum nunca passa em `is_platform_owner()`).
-- ============================================================================

create or replace function public.is_platform_owner()
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
      and role = 'owner'
  );
$$;

revoke execute on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

comment on function public.is_platform_owner() is
  'Etapa 15.7 — true somente quando o usuário autenticado tem role = owner (exclusivo, não inclui admin). Gate para ações de billing financeiro/configuração comercial que não devem ser acessíveis a admin comum.';
