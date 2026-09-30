-- ============================================================================
-- Etapa "B2.4.1 — Hardening de ownership do signup" — corrige 2 blockers da
-- auditoria B2.4:
--   1. a origem PÚBLICA de uma conta era inferida por `profiles.email` e por um
--      marcador em `user_metadata` (que o `generateLink` sobrescreve num
--      usuário pendente existente e que o próprio usuário logado consegue
--      editar) — uma conta preexistente podia ser "adotada" e ficar elegível
--      para exclusão;
--   2. o rollback apagava por heurística de tempo.
--
-- STATUS: candidata a promoção futura para Production — NÃO aplicada em
-- Production por esta etapa (só repositório/DEV). Substitui a versão de
-- `list_stale_pending_public_signups` da migration 20260926005045.
--
-- NOVO MODELO DE OWNERSHIP (provado empiricamente no DEV, smoke B2.4.1):
--   - a conta é criada por `admin.createUser` (ATÔMICO: o índice único
--     `users_email_partial_key` garante um único vencedor; quem perde nunca é
--     dono) com `app_metadata = { signup_flow: 'public_v1',
--     signup_attempt_nonce: <aleatório por request, gerado no servidor>,
--     signup_state: 'provisioning' | 'ready' }`;
--   - `app_metadata` é SERVER-ONLY: o usuário não consegue editá-la (provado)
--     e `generateLink`/`signUp` não a sobrescrevem;
--   - o servidor só apaga (rollback) uma conta depois de reler o usuário e
--     conferir o NONCE do próprio request.
--
-- (a) `get_auth_user_id_by_email`: consulta AUTORITATIVA em auth.users (o
--     `profiles.email` deixou de ser fonte de verdade para ownership).
-- (b) `list_stale_pending_public_signups`: além do marcador durável, exige uma
--     SEGUNDA evidência persistente — pelo menos uma linha em
--     `legal_consents` com `source = 'signup'` (gravada só pelo servidor, e só
--     depois de provar ownership).
-- ============================================================================

create or replace function public.get_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and u.deleted_at is null
    and coalesce(u.is_sso_user, false) = false
  limit 1;
$$;

revoke all on function public.get_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;

comment on function public.get_auth_user_id_by_email(text) is
  'Etapa B2.4.1 — id do usuário em auth.users por e-mail (fonte autoritativa, não profiles). Só service_role.';

create or replace function public.list_stale_pending_public_signups(
  p_cutoff timestamptz,
  p_limit integer default 100
)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email_confirmed_at is null
    and u.last_sign_in_at is null
    and u.deleted_at is null
    and u.is_anonymous = false
    and (u.banned_until is null or u.banned_until < now())
    and u.created_at < p_cutoff
    -- evidência 1: marcador DURÁVEL em app_metadata (server-only) + nonce do request que criou
    and u.raw_app_meta_data ->> 'signup_flow' = 'public_v1'
    and coalesce(u.raw_app_meta_data ->> 'signup_attempt_nonce', '') <> ''
    -- evidência 2: consentimento gravado pelo servidor no fluxo público
    and exists (
      select 1
      from public.legal_consents c
      where c.user_id = u.id
        and c.source = 'signup'
    )
    and p.role = 'user'
    and not exists (
      select 1 from public.internal_test_accounts i where i.user_id = u.id
    )
  order by u.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.list_stale_pending_public_signups(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_stale_pending_public_signups(timestamptz, integer) to service_role;

comment on function public.list_stale_pending_public_signups(timestamptz, integer) is
  'Etapa B2.4.1 — lista (não exclui) pendentes do fluxo público: não confirmado, nunca logou, app_metadata.signup_flow=public_v1 + nonce, consentimento signup em legal_consents, role user, fora de internal_test_accounts. Só service_role.';
