-- ============================================================================
-- Fundação de composição de metais (Etapa 2 — RPC transacional).
--
-- `set_collection_item_composition(p_collection_item_id, p_parts)` é o
-- ÚNICO escritor da composição de uma moeda (Etapa 1: collection_item_coin_parts
-- + collection_item_coin_part_components) e dos campos legados de
-- `collection_items` (metal_code/secondary_metal_code/purity), na mesma
-- transação — nenhum outro caminho de escrita deve gravar esses 3 campos
-- legados a partir de agora (ver decisão da revisão de arquitetura:
-- "single writer", não sincronização entre dois escritores).
--
-- SECURITY INVOKER (não DEFINER): as tabelas novas não têm FORCE ROW LEVEL
-- SECURITY, então um SECURITY DEFINER de propriedade de um role admin
-- bypassaria RLS silenciosamente — SECURITY INVOKER roda com o role de
-- quem chama (authenticated via PostgREST), preservando a RLS exatamente
-- como se o client tivesse executado o SQL diretamente. Mesmo padrão já
-- usado por `set_primary_collection_unit`.
--
-- Semântica de `percentage = NULL`: SEMPRE "proporção não informada",
-- nunca um valor numérico implícito (nem 100%) — se a aplicação sabe que
-- um componente é 100% da parte, grava 100 explicitamente. Ver comentário
-- da Etapa 1 na tabela collection_item_coin_part_components.
--
-- Ordem de execução: TODA validação (ownership, estrutura, componentes,
-- percentuais) acontece ANTES de qualquer DELETE/INSERT — nunca "apaga,
-- insere, descobre que é inválido, desfaz". Se o payload é inválido, a
-- composição existente nunca é tocada (nem mesmo um DELETE seguido de
-- rollback: o DELETE simplesmente não é alcançado).
-- ============================================================================

create or replace function public.set_collection_item_composition(
  p_collection_item_id uuid,
  p_parts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid                          uuid := (select auth.uid());
  v_owner                        uuid;

  v_part                         jsonb;
  v_part_ord                     integer;
  v_part_type                    text;
  v_part_sort                    integer;
  v_components                   jsonb;

  v_component                    jsonb;
  v_comp_ord                     integer;
  v_metal_code                   text;
  v_percentage_text              text;
  v_percentage                   numeric;
  v_comp_sort                    integer;

  v_body_count                   integer := 0;
  v_core_count                   integer := 0;
  v_ring_count                   integer := 0;
  v_plating_count                integer := 0;

  v_seen_metals                  text[];
  v_comp_count                   integer;
  v_null_count                   integer;
  v_sum                          numeric;

  v_new_part_id                  uuid;

  v_primary_part_id              uuid;
  v_secondary_part_id            uuid;
  v_legacy_metal_code            text;
  v_legacy_secondary_metal_code  text;
  v_legacy_purity                numeric;

  v_result                       jsonb;
begin
  -- --------------------------------------------------------------------
  -- 0. Sanidade de entrada
  -- --------------------------------------------------------------------
  if p_collection_item_id is null then
    raise exception 'p_collection_item_id não pode ser nulo.' using errcode = '22023';
  end if;

  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'p_parts precisa ser um array JSON (pode ser vazio, []).' using errcode = '22023';
  end if;

  -- --------------------------------------------------------------------
  -- 1. Ownership — nunca confiar só no client. A própria SELECT já é
  -- filtrada pela RLS de collection_items (select_own): se o item for de
  -- outro usuário ou não existir, v_owner fica nulo. O check explícito é
  -- necessário mesmo assim: sem ele, chamar esta função com p_parts=[]
  -- contra um item alheio faria DELETE/UPDATE afetarem 0 linhas
  -- silenciosamente (RLS filtra, não gera erro) e a função "teria
  -- sucesso" sem alterar nada de ninguém — mas sem o erro claro pedido.
  -- --------------------------------------------------------------------
  select ci.user_id into v_owner
  from public.collection_items ci
  where ci.id = p_collection_item_id;

  if v_uid is null or v_owner is null or v_owner <> v_uid then
    raise exception 'Você não tem permissão para alterar a composição desta moeda.' using errcode = '42501';
  end if;

  -- --------------------------------------------------------------------
  -- 2. Validação completa do payload — NENHUMA escrita nesta fase.
  -- --------------------------------------------------------------------
  for v_part, v_part_ord in
    select value, (ordinality - 1)::int
    from jsonb_array_elements(p_parts) with ordinality as t(value, ordinality)
  loop
    if jsonb_typeof(v_part) <> 'object' then
      raise exception 'Cada elemento de p_parts precisa ser um objeto JSON.' using errcode = '22023';
    end if;

    v_part_type := v_part->>'part';
    if v_part_type is null or v_part_type not in ('body', 'core', 'ring', 'plating') then
      raise exception 'part inválida: "%". Valores permitidos: body, core, ring, plating.', coalesce(v_part_type, '<ausente>') using errcode = '22023';
    end if;

    if v_part_type = 'body' then
      v_body_count := v_body_count + 1;
    elsif v_part_type = 'core' then
      v_core_count := v_core_count + 1;
    elsif v_part_type = 'ring' then
      v_ring_count := v_ring_count + 1;
    elsif v_part_type = 'plating' then
      v_plating_count := v_plating_count + 1;
    end if;

    v_components := v_part->'components';
    if v_components is null or jsonb_typeof(v_components) <> 'array' or jsonb_array_length(v_components) = 0 then
      raise exception 'A parte "%" precisa ter ao menos 1 componente.', v_part_type using errcode = '22023';
    end if;

    v_seen_metals := array[]::text[];
    v_comp_count := 0;
    v_null_count := 0;
    v_sum := 0;

    for v_component, v_comp_ord in
      select value, (ordinality - 1)::int
      from jsonb_array_elements(v_components) with ordinality as t(value, ordinality)
    loop
      if jsonb_typeof(v_component) <> 'object' then
        raise exception 'Cada componente precisa ser um objeto JSON.' using errcode = '22023';
      end if;

      v_metal_code := v_component->>'metalCode';
      if v_metal_code is null or v_metal_code = '' then
        raise exception 'metalCode é obrigatório em todo componente (parte "%").', v_part_type using errcode = '22023';
      end if;

      if v_metal_code = any (v_seen_metals) then
        raise exception 'Metal "%" duplicado na mesma parte ("%").', v_metal_code, v_part_type using errcode = '23505';
      end if;
      v_seen_metals := array_append(v_seen_metals, v_metal_code);

      if not exists (select 1 from public.metals m where m.code = v_metal_code) then
        raise exception 'Metal "%" não existe no catálogo.', v_metal_code using errcode = '23503';
      end if;

      v_percentage_text := v_component->>'percentage';
      if v_percentage_text is null then
        v_percentage := null;
        v_null_count := v_null_count + 1;
      else
        begin
          v_percentage := v_percentage_text::numeric;
        exception when others then
          raise exception 'percentage inválido: "%" (parte "%", metal "%").', v_percentage_text, v_part_type, v_metal_code using errcode = '22023';
        end;

        if v_percentage <= 0 or v_percentage > 100 then
          raise exception 'percentage precisa estar entre 0 (exclusivo) e 100 (inclusive) — recebido % (parte "%", metal "%").', v_percentage, v_part_type, v_metal_code using errcode = '22023';
        end if;

        v_sum := v_sum + v_percentage;
      end if;

      v_comp_count := v_comp_count + 1;
    end loop;

    if v_null_count > 0 and v_null_count < v_comp_count then
      raise exception 'Na parte "%", ou todos os componentes têm percentage, ou nenhum tem — não é permitido misturar.', v_part_type using errcode = '22023';
    end if;

    if v_null_count = 0 and abs(v_sum - 100) > 0.1 then
      raise exception 'Na parte "%", a soma dos percentuais precisa ser 100%% (tolerância ±0.1) — soma recebida: %.', v_part_type, v_sum using errcode = '22023';
    end if;
  end loop;

  -- --------------------------------------------------------------------
  -- 3. Regras estruturais entre partes (ainda sem escrever nada).
  -- --------------------------------------------------------------------
  if v_body_count > 1 then
    raise exception 'No máximo 1 parte "body" é permitida (recebidas: %).', v_body_count using errcode = '22023';
  end if;

  if v_core_count > 1 then
    raise exception 'No máximo 1 parte "core" é permitida (recebidas: %).', v_core_count using errcode = '22023';
  end if;

  if v_plating_count > 1 then
    raise exception 'No máximo 1 parte "plating" é permitida (recebidas: %).', v_plating_count using errcode = '22023';
  end if;

  if v_body_count > 0 and (v_core_count > 0 or v_ring_count > 0) then
    raise exception '"body" não pode coexistir com "core"/"ring" no mesmo item.' using errcode = '22023';
  end if;

  if (v_core_count > 0) <> (v_ring_count > 0) then
    raise exception '"core" e "ring" precisam existir juntos (não é permitido um sem o outro).' using errcode = '22023';
  end if;

  if v_plating_count > 0 and v_body_count = 0 and v_core_count = 0 and v_ring_count = 0 then
    raise exception '"plating" exige que exista "body" ou "core"/"ring" no mesmo payload.' using errcode = '22023';
  end if;

  -- --------------------------------------------------------------------
  -- 4. Payload 100% válido — substitui a composição atomicamente.
  -- --------------------------------------------------------------------
  delete from public.collection_item_coin_parts
  where collection_item_id = p_collection_item_id;

  for v_part, v_part_ord in
    select value, (ordinality - 1)::int
    from jsonb_array_elements(p_parts) with ordinality as t(value, ordinality)
  loop
    v_part_type := v_part->>'part';
    v_part_sort := coalesce((v_part->>'sortOrder')::int, v_part_ord);

    insert into public.collection_item_coin_parts (collection_item_id, part, sort_order)
    values (p_collection_item_id, v_part_type, v_part_sort)
    returning id into v_new_part_id;

    for v_component, v_comp_ord in
      select value, (ordinality - 1)::int
      from jsonb_array_elements(v_part->'components') with ordinality as t(value, ordinality)
    loop
      v_metal_code := v_component->>'metalCode';
      v_percentage_text := v_component->>'percentage';
      v_percentage := case when v_percentage_text is null then null else v_percentage_text::numeric end;
      v_comp_sort := coalesce((v_component->>'sortOrder')::int, v_comp_ord);

      insert into public.collection_item_coin_part_components (part_id, metal_code, percentage, sort_order)
      values (v_new_part_id, v_metal_code, v_percentage, v_comp_sort);
    end loop;
  end loop;

  -- --------------------------------------------------------------------
  -- 5. Derivação dos campos legados — feita a partir do que foi
  -- efetivamente gravado (ordenado por sort_order real, não pela ordem
  -- de chegada no array), conforme os 6 casos da arquitetura aprovada.
  -- --------------------------------------------------------------------
  v_legacy_metal_code := null;
  v_legacy_secondary_metal_code := null;
  v_legacy_purity := null;

  if v_body_count = 1 then
    select p.id into v_primary_part_id
    from public.collection_item_coin_parts p
    where p.collection_item_id = p_collection_item_id and p.part = 'body'
    limit 1;
  elsif v_core_count = 1 then
    select p.id into v_primary_part_id
    from public.collection_item_coin_parts p
    where p.collection_item_id = p_collection_item_id and p.part = 'core'
    limit 1;

    select p.id into v_secondary_part_id
    from public.collection_item_coin_parts p
    where p.collection_item_id = p_collection_item_id and p.part = 'ring'
    order by p.sort_order asc
    limit 1;
  end if;
  -- 'plating' nunca participa da derivação legada (Caso 4) — nem quando é
  -- a única outra parte além de body/core/ring.

  if v_primary_part_id is not null then
    select count(*) into v_comp_count
    from public.collection_item_coin_part_components c
    where c.part_id = v_primary_part_id;

    -- Componente dominante: maior percentage quando informados; se todos
    -- forem NULL, o critério de desempate (sort_order) já resolve sozinho
    -- porque "percentage desc nulls last" não discrimina entre nulos.
    select c.metal_code, c.percentage into v_legacy_metal_code, v_percentage
    from public.collection_item_coin_part_components c
    where c.part_id = v_primary_part_id
    order by c.percentage desc nulls last, c.sort_order asc
    limit 1;

    if v_comp_count = 1 and v_percentage is not null then
      v_legacy_purity := v_percentage / 100.0;
    else
      v_legacy_purity := null;
    end if;
  end if;

  if v_secondary_part_id is not null then
    select c.metal_code into v_legacy_secondary_metal_code
    from public.collection_item_coin_part_components c
    where c.part_id = v_secondary_part_id
    order by c.percentage desc nulls last, c.sort_order asc
    limit 1;
  end if;

  update public.collection_items
  set metal_code = v_legacy_metal_code,
      secondary_metal_code = v_legacy_secondary_metal_code,
      purity = v_legacy_purity
  where id = p_collection_item_id;

  -- --------------------------------------------------------------------
  -- 6. Retorno — composição final já persistida, lida de volta do banco.
  -- --------------------------------------------------------------------
  select jsonb_build_object(
    'collectionItemId', p_collection_item_id,
    'parts', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'part', p.part,
            'sortOrder', p.sort_order,
            'components', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', c.id,
                    'metalCode', c.metal_code,
                    'percentage', c.percentage,
                    'sortOrder', c.sort_order
                  )
                  order by c.sort_order
                )
                from public.collection_item_coin_part_components c
                where c.part_id = p.id
              ),
              '[]'::jsonb
            )
          )
          order by p.sort_order
        )
        from public.collection_item_coin_parts p
        where p.collection_item_id = p_collection_item_id
      ),
      '[]'::jsonb
    ),
    'legacy', jsonb_build_object(
      'metalCode', v_legacy_metal_code,
      'secondaryMetalCode', v_legacy_secondary_metal_code,
      'purity', v_legacy_purity
    )
  ) into v_result;

  return v_result;
end;
$$;

-- `revoke all ... from public` só afeta o grant herdado do pseudo-role
-- PUBLIC — o template padrão do Supabase concede EXECUTE em toda função
-- nova diretamente para `anon` também (grant direto, não herdado), então
-- é preciso revogar `anon` explicitamente para esta RPC não ficar
-- acessível a chamadas não autenticadas (mesmo a lógica interna já
-- bloqueando por `auth.uid() is null`, isso não deve depender só disso).
revoke all on function public.set_collection_item_composition(uuid, jsonb) from public;
revoke execute on function public.set_collection_item_composition(uuid, jsonb) from anon;
grant execute on function public.set_collection_item_composition(uuid, jsonb) to authenticated;
