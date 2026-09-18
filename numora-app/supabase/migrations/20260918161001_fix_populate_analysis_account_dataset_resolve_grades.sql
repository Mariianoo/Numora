-- ============================================================================
-- Etapa "5.10W.4 — correção de portabilidade" — `populate_analysis_account_dataset()`
-- deixa de depender de IDs de `grades` fixos no código.
--
-- PROBLEMA (auditoria final W.4): a versão original (migration
-- 20260915214448) listava 12 identificadores literais de `grades.id`. Esse
-- `id` é `gen_random_uuid()` gerado no INSERT do seed
-- (20260812090100_seed_reference_tables.sql) — portanto DIFERENTE em cada
-- banco (DEV, Production, banco recriado pelas migrations). Em qualquer
-- ambiente que não fosse o DEV original, `collection_units.grade_id`
-- violaria a FK e a população falharia.
--
-- CORREÇÃO: cada grade passa a ser resolvida pela chave estável
-- `(scale, code)` — `uq_grades_scale_code` (UNIQUE) e valores literais no
-- próprio seed, idênticos em todo ambiente. Os lookups acontecem UMA vez,
-- antes de qualquer INSERT; se qualquer grade necessária não existir, a
-- função lança um erro explícito listando as ausentes e NADA é inserido
-- (nenhum dataset parcial).
--
-- O QUE NÃO MUDA (só o modo de resolver `grade_id` mudou): assinatura,
-- SECURITY DEFINER, search_path, grants, autorização owner-only, exigência
-- de `internal_test_accounts`, idempotência, atomicidade e TODO o dataset
-- (35 itens, países, compras, unidades, composição, ratings, statuses,
-- labels). A ordem dos códigos abaixo reproduz exatamente a ordem dos
-- antigos arrays de IDs, então cada item continua recebendo a MESMA grade
-- de antes.
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

  -- Grades resolvidas por (scale, code) — chave estável entre ambientes.
  v_grade_codes_br constant text[] := array['SOF','REG','BC','MBC','SOB','FC'];
  v_grade_codes_sheldon constant text[] := array['G4','VF20','EF40','MS60','MS63','MS65'];
  v_grades_br uuid[];
  v_grades_sheldon uuid[];
  v_missing_grades text;

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

  -- Valida ANTES de qualquer INSERT que todas as grades necessárias existem
  -- neste banco — falha explícita, nunca um dataset parcial.
  select string_agg(m.scale || ':' || m.code, ', ' order by m.scale, m.code)
  into v_missing_grades
  from (
    select 'br'::text as scale, t.code from unnest(v_grade_codes_br) as t(code)
    union all
    select 'sheldon'::text as scale, t.code from unnest(v_grade_codes_sheldon) as t(code)
  ) m
  where not exists (
    select 1 from public.grades g where g.scale = m.scale and g.code = m.code
  );

  if v_missing_grades is not null then
    raise exception 'Grades de referência ausentes em public.grades (escala:código): %. O dataset da Conta de Análise não foi criado.', v_missing_grades;
  end if;

  -- `with ordinality` + `order by c.ord` preservam a ordem dos códigos
  -- declarados acima (mesma ordem dos antigos arrays de IDs).
  select array_agg(g.id order by c.ord) into v_grades_br
  from unnest(v_grade_codes_br) with ordinality as c(code, ord)
  join public.grades g on g.scale = 'br' and g.code = c.code;

  select array_agg(g.id order by c.ord) into v_grades_sheldon
  from unnest(v_grade_codes_sheldon) with ordinality as c(code, ord)
  join public.grades g on g.scale = 'sheldon' and g.code = c.code;

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
    -- da migration original sobre por que não é possível chamar
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
  -- da migration original). Só os 8 primeiros itens criados recebem
  -- label_code, para permitir testar "com etiqueta" e "sem etiqueta ainda".
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
  'Etapa "5.10W.3 — Conta de Análise" (corrigida em 5.10W.4) — popula um dataset fictício determinístico (35 collection_items + purchases + collection_units + composição real + alguns label_codes) para uma Conta de Análise. Grades resolvidas por (scale, code) — nunca por id fixo. Somente owner; revalida internal_test_accounts internamente. Idempotente: nunca duplica se já houver qualquer collection_item para o user_id. Nunca cria coin_images (exigiria Storage real) nem altera profiles.passport_public.';
