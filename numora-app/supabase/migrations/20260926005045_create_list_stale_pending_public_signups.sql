-- ============================================================================
-- Etapa "B2.4 — Signup server-controlled" — infraestrutura de LIMPEZA de
-- cadastros públicos pendentes (retenção de 7 dias, decisão de produto).
--
-- STATUS: candidata a promoção futura para Production — NÃO aplicada em
-- Production por esta etapa (só repositório/DEV).
--
-- Esta função só LISTA candidatos; quem exclui é o código do servidor
-- (lib/auth/pending-signup-cleanup.ts, via Admin API), que ainda revalida
-- cada usuário imediatamente antes de excluir (defesa contra corrida com uma
-- confirmação de e-mail). Retorna SOMENTE usuários que satisfazem TODAS as
-- condições — qualquer uma faltando exclui o usuário da lista:
--   - e-mail NÃO confirmado e nunca logou (last_sign_in_at nulo);
--   - não anônimo, não excluído, não banido;
--   - criado antes de `p_cutoff` (o chamador passa agora − 7 dias);
--   - criado PELO FLUXO PÚBLICO server-controlled: marcador
--     `raw_user_meta_data.signup_flow = 'public_v1'`. Para um usuário NÃO
--     confirmado esse valor só pode ter sido escrito pelo servidor (Admin
--     API): o usuário não tem sessão para editar a própria metadata e o
--     GoTrue público está com signup desabilitado;
--   - `profiles.role = 'user'` (nunca owner/admin/support/finance/seller);
--   - fora de `internal_test_accounts` (Contas de Análise).
-- Contas confirmadas, usuários existentes, convites administrativos e contas
-- criadas por outros meios NUNCA aparecem aqui.
--
-- GRANTS: SECURITY DEFINER (precisa ler o schema `auth`); execução só para
-- `service_role` (server-only). `anon`/`authenticated`/PUBLIC não executam.
-- ============================================================================

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
    and u.raw_user_meta_data ->> 'signup_flow' = 'public_v1'
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
  'Etapa B2.4 — lista (não exclui) cadastros públicos pendentes antigos: não confirmados, nunca logaram, marcador signup_flow=public_v1, role user, fora de internal_test_accounts. Só service_role.';
