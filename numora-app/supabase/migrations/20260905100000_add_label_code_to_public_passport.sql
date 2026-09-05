-- ============================================================================
-- Etapa "F5 — Passport V2 Visual" — extensão APROVADA de `get_public_passport`
-- (proposta apresentada no relatório desta etapa, aprovação explícita do
-- responsável pelo produto antes desta migration ser criada): cada moeda no
-- array `coins` ganha `labelCode`.
--
-- Regras exigidas na aprovação, todas respeitadas literalmente aqui:
--   - usa exatamente `collection_items.label_code` (nenhuma geração/derivação);
--   - NÃO chama `ensure_label_codes()` — só lê a coluna, nunca escreve nela;
--   - quando `label_code` é NULL, o campo simplesmente vem `null` no JSON —
--     a UI decide não mostrar nada nesse caso (nenhuma etiqueta é gerada
--     como efeito colateral de visualizar o Passport);
--   - o UUID interno (`collection_items.id`) continua NUNCA exposto por esta
--     RPC — `labelCode` não é um substituto de identificador, é só o texto
--     já impresso na etiqueta física (mesmo raciocínio documentado em
--     `features/passport/types.ts` para `PublicPassportItem.coin.labelCode`);
--   - nenhuma regra de privacidade pré-existente foi tocada:
--     `passport_collection_visibility` ('none'/'all'/'selected'),
--     `collection_items.is_public`, `photo_public` e o filtro
--     `deleted_at is null` permanecem exatamente como estavam — o `label_code`
--     é lido da MESMA linha, dentro do MESMO `where`, sem nenhum join ou
--     condição nova.
--
-- Mesma assinatura, mesmo SECURITY DEFINER, mesmo search_path — extensão
-- cirúrgica de uma única chave no `jsonb_build_object` já existente
-- (comparado via `pg_get_functiondef` direto no banco antes de escrever esta
-- migration, para não repetir o desvio arquivo-vs-banco já documentado em
-- `20260901160200_update_get_public_passport_rpc.sql`). Nenhuma outra
-- alteração de comportamento.
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
        'quantity', ci.quantity,
        'photoStoragePath', case when ci.photo_public then pic.storage_path else null end,
        'labelCode', ci.label_code
      )
      order by ci.year desc nulls last, ci.created_at desc
    ), '[]'::jsonb)
    into v_coins
    from public.collection_items ci
    left join public.countries co on co.code = ci.country_code
    left join public.metals m on m.code = ci.metal_code
    left join public.metals sm on sm.code = ci.secondary_metal_code
    left join public.collection_units pu on pu.collection_item_id = ci.id and pu.is_primary = true
    left join public.coin_images pic on pic.collection_unit_id = pu.id and pic.kind = 'front'
    where ci.user_id = v_profile_id
      and ci.deleted_at is null
      and (v_visibility = 'all' or ci.is_public = true)
    limit 60;
  end if;

  v_result := v_result || jsonb_build_object('coins', v_coins, 'collectionVisibility', v_visibility);

  return v_result;
end;
$$;
