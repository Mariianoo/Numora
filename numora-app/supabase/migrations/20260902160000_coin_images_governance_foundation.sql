-- ============================================================================
-- Fundação de governança de imagens (primeira camada de proteção, antes de
-- qualquer identificação por IA/Numora Catalog futuros).
--
-- Modelo escolhido: publicação de FOTO é um ato EXPLÍCITO e INDEPENDENTE da
-- visibilidade de TEXTO da moeda (`collection_items.is_public` /
-- `profiles.passport_collection_visibility`). Mesmo com o modo 'all' (que
-- torna o texto de todas as moedas público automaticamente), NENHUMA foto
-- vira pública sem essa ação explícita separada — requisito explícito desta
-- etapa ("nenhuma imagem deve se tornar pública automaticamente").
--
-- `photo_public` vive em `collection_items` (não em `coin_images`) porque a
-- unidade de publicação no Passport é a MOEDA, não o exemplar/kind
-- individual — o Passport mostra 1 card por moeda, nunca por exemplar. Só a
-- foto de FRENTE do exemplar PRINCIPAL (is_primary = true) é elegível,
-- mesma convenção já usada por `CollectionItemThumbnail` para "a foto que
-- representa a moeda".
--
-- A derivação pública (recortada + com marca d'água + sem EXIF/GPS) é
-- gerada no NAVEGADOR (mesmo pipeline 100% client-side do upload original —
-- Canvas API nativa, nenhuma dependência nova) no momento em que o usuário
-- publica a foto, e enviada para um bucket SEPARADO, `coin-images-public`.
-- O bucket privado `coin-images` (original) nunca é alterado por esta
-- migration — reaproveitado como está, sem duplicar arquitetura.
--
-- O path da derivação pública é IDÊNTICO ao path relativo já usado no
-- bucket privado (`{user_id}/{collection_unit_id}/{kind}.webp}`) — só troca
-- o bucket. Isso evita precisar de uma coluna nova para "path público": a
-- RPC do Passport reaproveita `coin_images.storage_path` (coluna já
-- existente) e só decide, com base em `photo_public`, se deve expor esse
-- path para o bucket público.
-- ============================================================================

alter table public.collection_items
  add column photo_public boolean not null default false;

comment on column public.collection_items.photo_public is
  'Publicação EXPLÍCITA e independente de is_public/passport_collection_visibility: controla só se a foto de frente do exemplar principal tem uma derivação pública (com marca d''água, sem EXIF/GPS) no bucket coin-images-public. Nunca fica true automaticamente — mesmo no modo "all" de visibilidade de texto, a foto exige uma ação explícita separada do usuário.';

-- ----------------------------------------------------------------------------
-- Bucket PÚBLICO dedicado só a derivações com marca d'água — nunca a imagem
-- original. `coin-images` (privado, já existente) continua sendo a única
-- fonte de verdade da imagem original; este bucket só guarda cópias
-- derivadas, descartáveis e regeneráveis a qualquer momento a partir dela.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('coin-images-public', 'coin-images-public', true);

-- Leitura pública: o próprio bucket `public = true` já serve os objetos via
-- URL pública sem checar RLS (mecanismo do Supabase Storage) — a policy
-- abaixo só mantém o caminho de leitura via SDK (`.list()`/`.download()`)
-- consistente e documentado. Escopada estritamente a `bucket_id =
-- 'coin-images-public'`: nunca alcança linhas do bucket privado
-- `coin-images`, cujas 4 policies próprias (Etapa 9.1) permanecem
-- intocadas.
create policy "coin_images_public_objects_select_all"
  on storage.objects
  for select
  using (bucket_id = 'coin-images-public');

-- Escrita (publicar/atualizar/remover a derivação) só pelo dono — mesmo
-- padrão de ownership por path já usado em `coin-images` (primeiro
-- segmento do path = auth.uid()).
create policy "coin_images_public_objects_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'coin-images-public' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "coin_images_public_objects_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'coin-images-public' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'coin-images-public' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "coin_images_public_objects_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'coin-images-public' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ----------------------------------------------------------------------------
-- Extensão cirúrgica de `get_public_passport` (mesma assinatura, mesmo
-- SECURITY DEFINER, mesmo search_path) — cada moeda no array `coins` ganha
-- `photoStoragePath`, só preenchido quando `photo_public = true` E existe de
-- fato uma foto de frente cadastrada no exemplar principal (nunca aponta
-- para um arquivo que pode não existir). O restante da função é idêntico
-- ao corpo real hoje em DEVELOPMENT/Production (conferido via
-- pg_get_functiondef antes de escrever esta migration) — nenhuma outra
-- regra de visibilidade foi tocada.
-- ----------------------------------------------------------------------------
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
        'photoStoragePath', case when ci.photo_public then pic.storage_path else null end
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
