-- ============================================================================
-- Etapa "F4 — Numora Labels" — `get_public_passport_item()`, RPC pública
-- dedicada ao "Passport digital da moeda" (alvo do QR Code impresso na
-- etiqueta). Segue RIGOROSAMENTE a mesma disciplina de privacidade já
-- estabelecida por `get_public_passport` (Passport V1) — nenhuma segunda
-- lógica de visibilidade criada:
--
--   - `profiles.passport_public = true` continua sendo exigido.
--   - `profiles.passport_collection_visibility`: 'none' -> nunca revela
--     nenhum item; 'all' -> qualquer item ativo do usuário; 'selected' ->
--     só se `collection_items.is_public = true`.
--   - `collection_items.deleted_at is null` (item na lixeira nunca é
--     público, igual à lista agregada).
--   - `photoStoragePath` só preenchido quando `photo_public = true` E existe
--     foto de frente do exemplar principal — mesma condição exata da lista
--     agregada.
--   - NUNCA lê/retorna purchase_id, unit_cost, location, description,
--     mint/mintage/history/trivia/catalog_references, e-mail, tokens —
--     mesmíssimo subconjunto fixo de colunas que a lista agregada já usa.
--
-- Todo caso de falha (username não existe, Passport não é público, item não
-- existe, item de outro usuário, item na lixeira, item fora do modo de
-- visibilidade) retorna `null`, SEM diferenciação — a página
-- (`/passport/[username]/coin/[itemId]`) transforma `null` num 404 genérico
-- do Next.js, exatamente a mesma filosofia já documentada em
-- `app/passport/[username]/page.tsx` para o caso agregado.
--
-- `label_code` é incluído no retorno (diferente de `numora_id`, removido do
-- Passport agregado por já ser sequencial+de todo o perfil — expor cada
-- volume revelaria ordem/volume de cadastro). Aqui o risco é outro: o
-- `label_code` de UM item específico já está impresso na própria etiqueta
-- física que levou a pessoa a escanear o QR — mostrá-lo de volta na tela
-- não revela nada que a etiqueta já não tenha revelado.
-- ============================================================================

create or replace function public.get_public_passport_item(p_username text, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_username text := lower(trim(p_username));
  v_profile_id uuid;
  v_visibility text;
  v_profile jsonb;
  v_item jsonb;
begin
  if v_username is null or v_username = '' or p_item_id is null then
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
  into v_profile_id, v_visibility, v_profile
  from public.profiles p
  left join public.countries c on c.code = p.country_code
  where p.username = v_username
    and p.passport_public = true;

  if v_profile_id is null then
    return null;
  end if;

  if v_visibility = 'none' then
    return null;
  end if;

  select jsonb_build_object(
    'labelCode', ci.label_code,
    'countryCode', ci.country_code,
    'countryName', co.name,
    'countryFlagEmoji', co.flag_emoji,
    'year', ci.year,
    'denomination', ci.denomination,
    'metalName', m.name,
    'secondaryMetalName', sm.name,
    'quantity', ci.quantity,
    'photoStoragePath', case when ci.photo_public then pic.storage_path else null end
  )
  into v_item
  from public.collection_items ci
  left join public.countries co on co.code = ci.country_code
  left join public.metals m on m.code = ci.metal_code
  left join public.metals sm on sm.code = ci.secondary_metal_code
  left join public.collection_units pu on pu.collection_item_id = ci.id and pu.is_primary = true
  left join public.coin_images pic on pic.collection_unit_id = pu.id and pic.kind = 'front'
  where ci.id = p_item_id
    and ci.user_id = v_profile_id
    and ci.deleted_at is null
    and (v_visibility = 'all' or ci.is_public = true);

  if v_item is null then
    return null;
  end if;

  -- Aninhado em `coin` de propósito: `v_profile` e `v_item` têm chaves com o
  -- MESMO nome (countryCode/countryName/countryFlagEmoji — país do
  -- colecionador vs. país de cunhagem da moeda, conceitos diferentes). Um
  -- `||` direto faria o país da moeda sobrescrever silenciosamente o país
  -- do colecionador. Aninhar evita a colisão sem precisar renomear nenhum
  -- campo (mantém os mesmos nomes já usados em `PublicPassportCoin`).
  return v_profile || jsonb_build_object('coin', v_item);
end;
$$;

-- Sem GRANT/REVOKE explícito de propósito: mesmo estado de privilégios
-- default do `get_public_passport` original (nunca teve revoke/grant
-- próprio, ver 20260813150533_create_get_public_passport_rpc.sql) —
-- `PUBLIC` mantém EXECUTE por padrão, o que já é exigido aqui (visitante
-- anônimo escaneando o QR precisa conseguir chamar esta RPC sem sessão).

comment on function public.get_public_passport_item(text, uuid) is
  'Etapa "F4 — Numora Labels" — Passport público de UM collection_item (alvo do QR da etiqueta). Reaproveita exatamente as regras de get_public_passport (passport_public, passport_collection_visibility, is_public, photo_public); nunca retorna purchase_id/unit_cost/location/description/mint/mintage/history/trivia/catalog_references/e-mail. null para QUALQUER motivo de indisponibilidade, sem diferenciar (username inexistente, Passport privado, item inexistente/de outro usuário/excluído/fora da visibilidade selecionada) — mesma filosofia de get_public_passport.';
