-- ============================================================================
-- Passport V1, Fase 5 — RPC pública dedicada para "Explorar" (/explore).
-- Mesma filosofia de segurança de `get_public_passport`: uma sessão
-- anônima nunca faz query direta em `profiles`/`collection_items`, só
-- chama esta função `SECURITY DEFINER`, que decide sozinha o que é seguro
-- listar. Só perfis com `passport_public = true` podem aparecer — o WHERE
-- é a única condição de inclusão, sem exceção.
--
-- Paginação simples (limit/offset), sem contagem total: a UI de Explorar
-- só precisa saber "cabe mais uma página?" (feito pedindo p_limit + 1 e
-- descartando o excedente) — nenhum COUNT(*) full-scan é necessário nesta
-- primeira versão.
--
-- Mesmos campos de `get_public_passport` (nunca email/role/plan_tier/
-- dados financeiros); os agregados por perfil (totalCoins/countriesCount)
-- são calculados só para os perfis já paginados (nunca a tabela inteira).
--
-- Ajuste pré-commit: `numoraId` REMOVIDO do retorno, mesma decisão de
-- produto aplicada em `get_public_passport` (ver migration
-- `20260901160200`) — o ID sequencial nunca precisa aparecer em nenhuma
-- superfície pública, nem no Passport individual nem em Explorar.
-- ============================================================================

create or replace function public.list_public_passports(p_limit integer default 24, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  with page as (
    select p.id, p.name, p.username, p.avatar_url, p.country_code,
           c.name as country_name, c.flag_emoji as country_flag_emoji,
           p.collector_since, p.created_at
    from public.profiles p
    left join public.countries c on c.code = p.country_code
    where p.passport_public = true
      and p.username is not null
    order by p.created_at desc
    limit v_limit + 1
    offset v_offset
  ),
  trimmed as (
    select * from page order by created_at desc limit v_limit
  ),
  page_stats as (
    select ci.user_id,
           count(*) as total_coins,
           count(distinct ci.country_code) as countries_count
    from public.collection_items ci
    where ci.user_id in (select id from trimmed)
      and ci.deleted_at is null
    group by ci.user_id
  )
  select jsonb_build_object(
    'entries', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', trimmed.name,
            'username', trimmed.username,
            'avatarUrl', trimmed.avatar_url,
            'countryCode', trimmed.country_code,
            'countryName', trimmed.country_name,
            'countryFlagEmoji', trimmed.country_flag_emoji,
            'collectorSince', trimmed.collector_since,
            'totalCoins', coalesce(page_stats.total_coins, 0),
            'countriesCount', coalesce(page_stats.countries_count, 0)
          )
          order by trimmed.created_at desc
        )
        from trimmed
        left join page_stats on page_stats.user_id = trimmed.id
      ),
      '[]'::jsonb
    ),
    'hasMore', (select count(*) from page) > v_limit
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.list_public_passports(integer, integer) is
  'Fonte de leitura pública de /explore — só profiles.passport_public = true. Nunca lê email/role/plan_tier/dados financeiros. SECURITY DEFINER, EXECUTE liberado a anon/authenticated (mesmo padrão intencional de get_public_passport).';
