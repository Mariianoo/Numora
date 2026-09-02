-- ============================================================================
-- Passport V1, Fase 2/3 — estende `get_public_passport` para devolver a
-- lista de moedas públicas (quando aplicável), sem criar uma segunda
-- fonte de leitura pública: esta RPC continua sendo o ÚNICO ponto que uma
-- sessão anônima usa para ler dados do Passport.
--
-- IMPORTANTE (achado da auditoria do Passport): o corpo abaixo parte da
-- definição REAL hoje em Production (lida via pg_get_functiondef durante a
-- auditoria), não do texto da migration `20260813150533`, que está
-- desatualizado em relação ao banco (falta o filtro `ci.deleted_at is
-- null` no bloco de agregados — alguém aplicou esse ajuste direto no
-- banco em algum momento, sem migration correspondente). Este arquivo
-- corrige essa divergência para quem aplicar as migrations do zero, além
-- de adicionar os campos novos.
--
-- Lista de moedas (`coins`):
--   - 'none'     -> sempre '[]' (nenhuma moeda individual, só agregados).
--   - 'all'      -> toda a coleção ATIVA (deleted_at is null) do usuário.
--   - 'selected' -> só collection_items com is_public = true.
-- Em qualquer modo, só os campos abaixo são lidos — nunca purchase_id,
-- unit_cost_override, description, location, tags, mint/mintage/
-- history/trivia/catalog_references (dados que podem conter anotação
-- pessoal do colecionador, não só "dados financeiros" — mantidos privados
-- por padrão nesta primeira versão, mesmo critério conservador já usado
-- pelos agregados). Limit 60: teto de payload da V1, sem paginação da
-- lista de moedas ainda (fora de escopo desta etapa).
--
-- Ajuste pré-commit: `numoraId` REMOVIDO do retorno. A coluna
-- `profiles.numora_id` continua existindo normalmente (perfil privado,
-- banco) — só a apresentação pública foi cortada, a pedido do produto:
-- o username já identifica publicamente o colecionador, e o ID é
-- sequencial (exporia ordem de cadastro/volume de usuários sem
-- necessidade). Nenhuma migration adicional para isso: como esta
-- migration ainda não tinha sido aplicada em Production, o ajuste entra
-- direto aqui, sem uma segunda migration de correção.
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
  v_visibility text;
  v_result jsonb;
  v_coins jsonb;
begin
  if v_username is null or v_username = '' then
    return null;
  end if;

  select p.id, p.passport_collection_visibility, jsonb_build_object(
    'name', p.name,
    'username', p.username,
    'avatarUrl', p.avatar_url,
    'countryCode', p.country_code,
    'countryName', c.name,
    'countryFlagEmoji', c.flag_emoji,
    'collectorSince', p.collector_since
  )
  into v_profile_id, v_visibility, v_result
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
  where ci.user_id = v_profile_id
    and ci.deleted_at is null;

  if v_visibility = 'none' then
    v_coins := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'countryCode', ci.country_code,
        'countryName', co.name,
        'countryFlagEmoji', co.flag_emoji,
        'year', ci.year,
        'denomination', ci.denomination,
        'metalName', m.name,
        'secondaryMetalName', sm.name,
        'quantity', ci.quantity
      )
      order by ci.year desc nulls last, ci.created_at desc
    ), '[]'::jsonb)
    into v_coins
    from public.collection_items ci
    left join public.countries co on co.code = ci.country_code
    left join public.metals m on m.code = ci.metal_code
    left join public.metals sm on sm.code = ci.secondary_metal_code
    where ci.user_id = v_profile_id
      and ci.deleted_at is null
      and (v_visibility = 'all' or ci.is_public = true)
    limit 60;
  end if;

  v_result := v_result || jsonb_build_object('coins', v_coins, 'collectionVisibility', v_visibility);

  return v_result;
end;
$$;
