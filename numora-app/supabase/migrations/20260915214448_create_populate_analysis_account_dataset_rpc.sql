-- ============================================================================
-- Etapa "5.10W.3 — Conta de Análise: dataset fictício" — RPC de população.
--
-- ACHADOS REPORTADOS EXPLICITAMENTE (per instrução: "não implementar
-- silenciosamente"), sobre por que a composição/labels são escritas
-- DIRETAMENTE nas tabelas reais em vez de chamar as RPCs de cliente já
-- existentes:
--
--   1) COMPOSIÇÃO: `set_collection_item_composition()` é `SECURITY
--      INVOKER` DE PROPÓSITO (documentado na própria migration:
--      `collection_item_coin_parts`/`_components` não têm FORCE ROW LEVEL
--      SECURITY, então um SECURITY DEFINER bypassaria RLS silenciosamente)
--      e valida `collection_items.user_id = auth.uid()`. Esta função de
--      população é chamada pelo OWNER (nunca pela própria Conta de
--      Análise), então `auth.uid()` dentro dessa RPC nunca bateria com o
--      `user_id` da Conta de Análise — chamá-la a partir daqui sempre
--      falharia com 42501. Solução adotada: esta function (já SECURITY
--      DEFINER, já precisa bypassar RLS de qualquer forma para popular
--      dados de outro usuário) escreve DIRETAMENTE em
--      `collection_item_coin_parts`/`_components` reproduzindo EXATAMENTE
--      a mesma regra de derivação dos campos legados
--      (`metal_code`/`secondary_metal_code`/`purity`) que
--      `set_collection_item_composition()` usa — nunca inventa um novo
--      formato, nunca preenche campo que a regra real não preencheria
--      (ver nota sobre `purity` abaixo).
--
--   2) LABELS: `ensure_label_codes()` também é gated por
--      `collection_items.user_id = auth.uid()` (embora seja SECURITY
--      DEFINER) — mesmo problema cross-user. Solução: alguns itens do
--      dataset recebem `label_code` atribuído diretamente aqui, usando a
--      MESMA sequence real (`label_code_seq`) e o MESMO formato
--      (`NMR-0000001`) que `ensure_label_codes()` usa — nunca uma
--      numeração paralela.
--
--   3) FOTOS (`coin_images`): NÃO populadas nesta etapa. Uma foto real
--      exige um objeto real no Storage (bucket `coin-images`) — inserir
--      uma linha em `coin_images` com um `storage_path` fictício sem o
--      arquivo real por trás seria um mock inconsistente com o estado
--      real do Storage (exatamente o tipo de mock que esta etapa pede
--      para NUNCA criar). Reportado aqui, não implementado.
--
--   4) PASSPORT: este dataset marca alguns itens com `is_public = true`
--      (campo simples, sem derivação complexa, seguro de escrever
--      diretamente). Isso sozinho NÃO torna o Passport publicamente
--      visível — falta também `profiles.passport_public = true` e
--      `passport_collection_visibility` adequados, que são configurações
--      da CONTA (não do dataset) e continuam dependendo do mesmo fluxo
--      real de `/dashboard/profile` que qualquer usuário usaria — não
--      alterados por esta RPC, de propósito (fora do escopo de "dataset").
--
-- NOTA SOBRE `purity`: auditado antes de escrever este arquivo —
-- `set_collection_item_composition()` só deriva `purity` (≠ null) quando
-- a parte dominante tem EXATAMENTE 1 componente com `percentage` não-nulo
-- (e nesse caso `purity = percentage / 100`); como a MESMA função exige
-- que a soma dos percentuais de uma parte seja exatamente 100% quando
-- informados, um componente ÚNICO só pode ser 100% ou `null` — ou seja, a
-- regra de negócio REAL de hoje NUNCA produz uma pureza fracionária
-- (ex.: 0.900) por este caminho, só `1.0` (metal único, 100%) ou `null`
-- (desconhecida, ou parte com múltiplos componentes). Este seed reproduz
-- fielmente essa mesma limitação real — nunca inventa uma pureza
-- fracionária que a aplicação de verdade não conseguiria produzir hoje.
--
-- DATASET: 35 collection_items (dentro do limite Free de 50, conforme
-- exigido), determinístico (todo valor deriva de `i` via aritmética
-- simples — nunca `random()`), com variedade real de país (15), ano/
-- década (1900–2024), metal (9), status/rating/grade, quantidade (a
-- maioria com 1 exemplar, alguns com 2), compra (a maioria com, alguns
-- sem), composição (metal único conhecido / desconhecido / bimetálica
-- real). Todos os textos são explicitamente rotulados como fictícios/demo
-- — nenhuma PII, nenhum dado financeiro real.
--
-- IDEMPOTÊNCIA: se a Conta de Análise já tiver qualquer `collection_item`,
-- a função NÃO insere nada — devolve `(populated: false, item_count: N)`
-- com a contagem existente. Nunca duplica, nunca decide sozinha apagar o
-- que já existe (isso é responsabilidade explícita de
-- `reset_analysis_account_dataset()`, chamada à parte).
-- ============================================================================

create or replace function public.populate_analysis_account_dataset(p_user_id uuid)
returns table (populated boolean, item_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_count integer;

  v_countries constant text[] := array['BR','US','PT','DE','FR','GB','JP','IT','ES','AR','MX','CA','CN','IN','CH'];
  v_metals constant text[] := array['AG','AU','CU','CUNI','BRONZE','NI','STEEL','BRASS','ZN'];
  v_mints constant text[] := array['Casa da Moeda Demo','Royal Demo Mint','Fictional Mint Co.','Mint Demonstração Numora'];
  v_sellers constant text[] := array['Demo Numismática','Colecionador Fictício','Loja Demonstração','Leilão Fictício Numora','Feira de Trocas Demo'];
  v_locations constant text[] := array['Cofre principal (demo)','Gaveta de exposição (demo)','Álbum temático (demo)','Caixa-forte (demo)'];
  v_tag_pool constant text[] := array['circulação','comemorativa','bimetálica','proof','antiga','moderna','coleção-principal','estudo'];
  v_grades_br constant uuid[] := array[
    '0e09e510-9b8f-4f72-8966-3666d501926f','1fce665e-af48-4fb3-95d4-019f26b26495','0ed67f96-4196-4a6f-8f76-4bdf6642d066',
    'a0b8fca3-d06d-444a-b157-3da81723eca0','c09a5843-708a-4bc0-a14c-ec56b06d763e','88e38143-5c7c-475c-b9bd-2f5eea133108'
  ]::uuid[];
  v_grades_sheldon constant uuid[] := array[
    '3bc40f88-6d63-472e-97e1-060c490ec224','5d41053d-77e2-478f-8b9b-f2f94a0907a4','ece69de2-2002-446f-8004-74093ab60414',
    '3fea0988-576a-4b51-8358-8a5b348ac0bb','705edbec-8ed6-495b-bd2d-b645c9842622','3ccb9d1a-5806-4d88-aa87-755a14d5513b'
  ]::uuid[];
  v_statuses constant text[] := array['in_collection','in_collection','in_collection','in_collection','for_sale','for_trade','reserved'];
  v_denominations constant text[] := array['1 Unidade Demo','5 Unidades Demo','10 Unidades Demo','25 Unidades Demo','50 Unidades Demo'];

  total_items constant integer := 35;

  v_item_id uuid;
  v_purchase_id uuid;
  v_part_id uuid;
  v_secondary_part_id uuid;

  v_country text;
  v_year int;
  v_metal text;
  v_secondary_metal text;
  v_mint text;
  v_weight numeric;
  v_face_value numeric;
  v_mintage bigint;
  v_grade_id uuid;
  v_status text;
  v_rating int;
  v_quantity int;
  v_total_price numeric;
  v_composition_case int;
  v_has_purchase boolean;
begin
  if not public.is_platform_owner() then
    raise exception 'Somente o owner pode popular o dataset da Conta de Análise.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.internal_test_accounts where user_id = p_user_id) then
    raise exception 'O user_id informado não é uma Conta de Análise (internal_test_accounts).' using errcode = '42501';
  end if;

  select count(*) into v_existing_count from public.collection_items where user_id = p_user_id;
  if v_existing_count > 0 then
    return query select false, v_existing_count;
    return;
  end if;

  for i in 1..total_items loop
    v_country := v_countries[1 + mod(i - 1, array_length(v_countries, 1))];
    v_year := 1900 + mod(i * 7, 125);
    v_metal := v_metals[1 + mod(i - 1, array_length(v_metals, 1))];
    v_mint := v_mints[1 + mod(i - 1, array_length(v_mints, 1))];
    v_weight := round((3 + mod(i * 3, 25) + mod(i, 10) / 10.0)::numeric, 2);
    v_face_value := (1 + mod(i, 10))::numeric;
    v_mintage := 100000 + (i * 987654);
    v_status := v_statuses[1 + mod(i - 1, array_length(v_statuses, 1))];
    v_rating := 1 + mod(i, 5);
    v_quantity := case when mod(i, 10) = 0 then 2 else 1 end;
    v_has_purchase := mod(i, 7) <> 0;
    v_composition_case := mod(i, 8);
    v_grade_id := case
      when mod(i, 2) = 0 then v_grades_br[1 + mod(i - 1, array_length(v_grades_br, 1))]
      else v_grades_sheldon[1 + mod(i - 1, array_length(v_grades_sheldon, 1))]
    end;

    insert into public.collection_items (
      user_id, country_code, year, denomination, mint, gross_weight_g, face_value,
      description, location, tags, mintage, history, trivia, catalog_references, is_public
    ) values (
      p_user_id,
      v_country,
      v_year,
      v_denominations[1 + mod(i - 1, array_length(v_denominations, 1))],
      v_mint,
      v_weight,
      v_face_value,
      'Item de demonstração da Conta de Análise (dado fictício nº ' || i || ') — nunca uma moeda real.',
      v_locations[1 + mod(i - 1, array_length(v_locations, 1))],
      array[v_tag_pool[1 + mod(i - 1, array_length(v_tag_pool, 1))], v_tag_pool[1 + mod(i, array_length(v_tag_pool, 1))]],
      v_mintage,
      'Histórico fictício de demonstração para o item nº ' || i || ' — conteúdo gerado para testes, sem valor numismático real.',
      'Curiosidade fictícia de demonstração para o item nº ' || i || '.',
      jsonb_build_array(jsonb_build_object('catalog', 'DEMO', 'code', 'D-' || lpad(i::text, 4, '0'))),
      (mod(i, 7) = 0)
    )
    returning id into v_item_id;

    v_purchase_id := null;
    if v_has_purchase then
      v_total_price := (10 + mod(i * 13, 300))::numeric;

      insert into public.purchases (user_id, total_price, currency, purchase_date, seller_name, notes, status)
      values (
        p_user_id,
        v_total_price,
        'BRL',
        (date '2018-01-01' + mod(i * 37, 2500) * interval '1 day')::date,
        v_sellers[1 + mod(i - 1, array_length(v_sellers, 1))],
        'Compra fictícia de demonstração (item nº ' || i || ') — nunca uma transação real.',
        'confirmed'
      )
      returning id into v_purchase_id;

      update public.collection_items set purchase_id = v_purchase_id where id = v_item_id;
    end if;

    for u in 1..v_quantity loop
      insert into public.collection_units (
        collection_item_id, grade_id, status, rating, is_primary, purchase_id, unit_cost, cost_origin, cost_type
      ) values (
        v_item_id,
        v_grade_id,
        v_status,
        v_rating,
        (u = 1),
        v_purchase_id,
        case when v_purchase_id is not null then round(v_total_price / v_quantity, 2) else null end,
        'auto',
        case when v_purchase_id is not null then 'purchase' else 'unknown' end
      );
    end loop;

    -- Composição — escrita direta reproduzindo a derivação real (ver nota
    -- no cabeçalho do arquivo sobre por que não é possível chamar
    -- set_collection_item_composition() a partir daqui).
    if v_composition_case = 0 then
      -- Bimetálica real: core + ring, 1 metal cada, 100% cada.
      v_secondary_metal := v_metals[1 + mod(i, array_length(v_metals, 1))];

      insert into public.collection_item_coin_parts (collection_item_id, part, sort_order)
      values (v_item_id, 'core', 0) returning id into v_part_id;
      insert into public.collection_item_coin_part_components (part_id, metal_code, percentage)
      values (v_part_id, v_metal, 100);

      insert into public.collection_item_coin_parts (collection_item_id, part, sort_order)
      values (v_item_id, 'ring', 1) returning id into v_secondary_part_id;
      insert into public.collection_item_coin_part_components (part_id, metal_code, percentage)
      values (v_secondary_part_id, v_secondary_metal, 100);

      update public.collection_items
      set metal_code = v_metal, secondary_metal_code = v_secondary_metal, purity = 1.0
      where id = v_item_id;
    elsif v_composition_case = 1 then
      -- Metal único, pureza desconhecida (percentage não informado).
      insert into public.collection_item_coin_parts (collection_item_id, part, sort_order)
      values (v_item_id, 'body', 0) returning id into v_part_id;
      insert into public.collection_item_coin_part_components (part_id, metal_code, percentage)
      values (v_part_id, v_metal, null);

      update public.collection_items
      set metal_code = v_metal, secondary_metal_code = null, purity = null
      where id = v_item_id;
    else
      -- Metal único, 100% (caso mais comum).
      insert into public.collection_item_coin_parts (collection_item_id, part, sort_order)
      values (v_item_id, 'body', 0) returning id into v_part_id;
      insert into public.collection_item_coin_part_components (part_id, metal_code, percentage)
      values (v_part_id, v_metal, 100);

      update public.collection_items
      set metal_code = v_metal, secondary_metal_code = null, purity = 1.0
      where id = v_item_id;
    end if;
  end loop;

  -- Labels — mesmo formato/sequence REAL de ensure_label_codes() (ver nota
  -- no cabeçalho sobre por que a RPC de cliente não pode ser chamada
  -- daqui). Só os 8 primeiros itens criados recebem label_code, para
  -- permitir testar tanto "com etiqueta" quanto "sem etiqueta ainda".
  update public.collection_items
  set label_code = 'NMR-' || lpad(nextval('public.label_code_seq')::text, 7, '0')
  where id in (
    select id from public.collection_items
    where user_id = p_user_id
    order by created_at asc
    limit 8
  );

  return query select true, total_items;
end;
$$;

revoke execute on function public.populate_analysis_account_dataset(uuid) from public, anon;
grant execute on function public.populate_analysis_account_dataset(uuid) to authenticated;

comment on function public.populate_analysis_account_dataset(uuid) is
  'Etapa "5.10W.3 — Conta de Análise" — popula um dataset fictício determinístico (35 collection_items + purchases + collection_units + composição real + alguns label_codes) para uma Conta de Análise. Somente owner; revalida internal_test_accounts internamente. Idempotente: nunca duplica se já houver qualquer collection_item para o user_id. Nunca cria coin_images (exigiria Storage real) nem altera profiles.passport_public — ver cabeçalho do arquivo.';
