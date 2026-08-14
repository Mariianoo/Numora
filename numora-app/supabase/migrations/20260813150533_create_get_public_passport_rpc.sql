-- ============================================================================
-- Fase 1, Etapa 8.2 — RPC pública do Passport (`/passport/[username]`).
-- `SECURITY DEFINER` porque a página é acessada por visitantes anônimos
-- (sem sessão) e precisa ler `profiles`/`collection_items` de OUTRO
-- usuário — RLS normal (dono via auth.uid()) bloquearia isso; a função
-- decide explicitamente o que é seguro expor: só perfis com
-- `passport_public = true`, e só campos agregados/públicos (nunca email,
-- nunca linha-a-linha de collection_items, nunca storage_path).
--
-- Reconstruída nesta auditoria (Etapa 10) a partir do estado real do
-- banco — arquivo original nunca foi commitado no repositório. Corpo
-- copiado verbatim de pg_get_functiondef('get_public_passport'::regproc),
-- não reescrito de memória. Grant de EXECUTE para `anon`/`authenticated`
-- já é o comportamento padrão do Supabase para funções novas (nunca
-- revogado depois, ao contrário de `coin_images`/`set_primary_collection_unit`
-- — este é o único RPC do projeto que é intencionalmente público).
-- ============================================================================

create or replace function public.get_public_passport(p_username text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_username text := lower(trim(p_username));
  v_profile_id uuid;
  v_result jsonb;
begin
  if v_username is null or v_username = '' then
    return null;
  end if;

  select p.id, jsonb_build_object(
    'name', p.name,
    'username', p.username,
    'numoraId', p.numora_id,
    'avatarUrl', p.avatar_url,
    'countryCode', p.country_code,
    'countryName', c.name,
    'countryFlagEmoji', c.flag_emoji,
    'collectorSince', p.collector_since
  )
  into v_profile_id, v_result
  from public.profiles p
  left join public.countries c on c.code = p.country_code
  where p.username = v_username
    and p.passport_public = true;

  if v_profile_id is null then
    return null;
  end if;

  select v_result || jsonb_build_object(
    'totalCoins', count(*),
    'totalUnits', coalesce(sum(ci.quantity), 0),
    'countriesCount', count(distinct ci.country_code),
    'metalsCount', count(distinct ci.metal_code),
    'minYear', min(ci.year),
    'maxYear', max(ci.year)
  )
  into v_result
  from public.collection_items ci
  where ci.user_id = v_profile_id;

  return v_result;
end;
$$;
