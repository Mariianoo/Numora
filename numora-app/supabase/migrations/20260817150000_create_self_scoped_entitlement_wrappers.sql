-- ============================================================================
-- Etapa 15.8-R2 (Revisão Final de Entitlements) — wrappers self-scoped.
--
-- ACHADO DA AUDITORIA: `get_entitlement(p_user_id, feature_key)` e
-- `check_entitlement_limit(p_user_id, feature_key, current_value)`
-- (Etapa 15.8) já são seguros — internamente exigem
-- `p_user_id = auth.uid() OR is_platform_admin()`, nunca expõem dado de
-- terceiro para um usuário comum. Não é uma falha de autorização.
--
-- Porém esta etapa pede explicitamente preferir uma função baseada
-- diretamente em `auth.uid()` para "uso normal do cliente", em vez de um
-- parâmetro `p_user_id` livre (mesmo que já gated). Esta migration
-- ADICIONA `get_my_entitlement()`/`check_my_entitlement_limit()` como a
-- via preferencial para consumo normal (self-only, sem parâmetro de
-- usuário) — as funções originais permanecem inalteradas e continuam
-- disponíveis para o caso de uso operacional legítimo de
-- admin/owner consultarem o entitlement de um usuário específico durante
-- suporte (leitura, não escrita — nunca configuração comercial).
--
-- Puramente aditivo: nenhuma função existente foi alterada, nenhuma
-- tabela nova, nenhum comportamento de `get_effective_plan()` tocado.
-- ============================================================================

create or replace function public.get_my_entitlement(p_feature_key text)
returns table (
  enabled boolean,
  limit_value integer,
  plan_slug text,
  source text
)
language sql
security definer
stable
set search_path = public
as $$
  select * from public.get_entitlement((select auth.uid()), p_feature_key);
$$;

revoke execute on function public.get_my_entitlement(text) from public, anon;
grant execute on function public.get_my_entitlement(text) to authenticated;

comment on function public.get_my_entitlement(text) is
  'Etapa 15.8-R2 — via preferencial para "uso normal do cliente": sempre auth.uid(), nunca um p_user_id arbitrário. Wrapper fino sobre get_entitlement(); mesma autorização, mesma fonte de verdade.';

create or replace function public.check_my_entitlement_limit(p_feature_key text, p_current_value integer)
returns table (
  allowed boolean,
  limit_value integer,
  current_value integer,
  remaining integer,
  plan_slug text
)
language sql
security definer
stable
set search_path = public
as $$
  select * from public.check_entitlement_limit((select auth.uid()), p_feature_key, p_current_value);
$$;

revoke execute on function public.check_my_entitlement_limit(text, integer) from public, anon;
grant execute on function public.check_my_entitlement_limit(text, integer) to authenticated;

comment on function public.check_my_entitlement_limit(text, integer) is
  'Etapa 15.8-R2 — via preferencial para "uso normal do cliente": sempre auth.uid(). Wrapper fino sobre check_entitlement_limit().';
