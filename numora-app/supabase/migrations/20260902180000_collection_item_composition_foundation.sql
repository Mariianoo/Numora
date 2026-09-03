-- ============================================================================
-- Fundação de composição de metais (Etapa 1 — schema).
--
-- Introduz suporte estrutural para representar corretamente: metal único,
-- ligas, moedas bimetálicas, trimetálicas (ou N componentes), revestimentos
-- (plating) e composição desconhecida — sem quebrar os campos legados
-- `collection_items.metal_code` / `secondary_metal_code` / `purity`, que
-- permanecem intactos nesta etapa (viram resumo derivado só quando a RPC
-- de escrita for implementada numa etapa futura — não faz parte desta
-- migration).
--
-- Modelo em dois níveis, decidido para resolver uma ambiguidade real: um
-- campo único `role` (núcleo/anel/revestimento/componente-de-liga) não
-- consegue expressar corretamente que percentuais de "núcleo" e "anel"
-- nunca devem ser somados entre si, enquanto percentuais de componentes de
-- uma MESMA liga devem somar 100% quando informados. Por isso:
--   - `collection_item_coin_parts` responde "onde, fisicamente, na moeda"
--     (corpo único, núcleo, anel, revestimento);
--   - `collection_item_coin_part_components` responde "o que compõe
--     aquela parte" (metal + percentual opcional), sempre relativo só à
--     própria parte, nunca cruzando partes diferentes.
--
-- `percentage = NULL` significa "proporção não informada/desconhecida" —
-- nunca um valor numérico implícito (nem mesmo 100%). Se a aplicação sabe
-- que um componente é 100% da parte, grava 100 explicitamente. Essa é uma
-- regra de aplicação (futura RPC), não impõe nada no schema além do CHECK
-- de faixa (0, 100].
--
-- Regras estruturais mais complexas (body XOR core/ring, core exige ring,
-- soma de percentuais = 100%, no máximo 1 plating, etc.) são
-- deliberadamente NÃO implementadas aqui como triggers — ficam para a RPC
-- transacional de uma etapa futura, que será o único ponto de escrita
-- planejado. Nesta migration só entram invariantes verificáveis numa
-- única linha ou por unicidade simples (CHECK/UNIQUE/FK), que protegem a
-- integridade estrutural mínima independente de quem escreve.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. metals.kind — distingue elemento químico de liga nomeada. Necessário
-- para o fluxo simples da UI (futuro) poder tratar "Bronze"/"Latão"/
-- "Cuproníquel"/"Aço" como uma opção única e opaca no mesmo dropdown que
-- Ouro/Prata/Cobre, sem forçar o usuário casual a detalhar componentes.
-- Nenhum código, nome ou is_precious de metal existente é alterado.
-- ----------------------------------------------------------------------------
alter table public.metals
  add column kind text;

update public.metals set kind = 'alloy'
  where code in ('CUNI', 'BRONZE', 'BRASS', 'STEEL');

update public.metals set kind = 'element'
  where code in ('AU', 'AG', 'PT', 'PD', 'CU', 'NI', 'ZN', 'SN', 'PB');

alter table public.metals
  alter column kind set not null;

alter table public.metals
  add constraint metals_kind_check check (kind in ('element', 'alloy'));

comment on column public.metals.kind is
  'Distingue elemento químico (''element'') de liga metálica nomeada (''alloy''). Existe para o fluxo simples do formulário tratar ligas comuns (Bronze, Latão, Cuproníquel, Aço) como uma única opção opaca — sem forçar o usuário a decompor em elementos, a menos que abra o detalhamento avançado de composição (Fundação de composição, etapa futura de RPC/UI).';

-- ----------------------------------------------------------------------------
-- 2. collection_item_coin_parts — a estrutura física da moeda.
-- ----------------------------------------------------------------------------
create table public.collection_item_coin_parts (
  id                   uuid primary key default gen_random_uuid(),
  collection_item_id   uuid not null references public.collection_items (id) on delete cascade,
  part                 text not null check (part in ('body', 'core', 'ring', 'plating')),
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now()
);

comment on table public.collection_item_coin_parts is
  'Fundação de composição — estrutura física de uma moeda: ''body'' (corpo único, moeda monometálica ou liga simples), ''core''/''ring'' (moeda bimetálica ou trimetálica — múltiplos ''ring'' são permitidos), ''plating'' (revestimento superficial sobre outra parte). Regras estruturais (body XOR core/ring, core exige ring, no máximo 1 plating) são responsabilidade da RPC de escrita (etapa futura), não deste schema.';

comment on column public.collection_item_coin_parts.part is
  '''body'' = corpo único; ''core''/''ring'' = núcleo/anel de moeda de múltiplas partes (ring pode repetir para trimetálicas); ''plating'' = revestimento superficial. Nunca ''body'' junto com ''core''/''ring'' no mesmo item — validado na aplicação, não aqui.';

create index idx_collection_item_coin_parts_item on public.collection_item_coin_parts (collection_item_id);

alter table public.collection_item_coin_parts enable row level security;

create policy "collection_item_coin_parts_select_own"
  on public.collection_item_coin_parts
  for select
  using (
    exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  );

create policy "collection_item_coin_parts_insert_own"
  on public.collection_item_coin_parts
  for insert
  with check (
    exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  );

create policy "collection_item_coin_parts_update_own"
  on public.collection_item_coin_parts
  for update
  using (
    exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  );

create policy "collection_item_coin_parts_delete_own"
  on public.collection_item_coin_parts
  for delete
  using (
    exists (
      select 1 from public.collection_items ci
      where ci.id = collection_item_id and ci.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 3. collection_item_coin_part_components — o que compõe cada parte.
-- ----------------------------------------------------------------------------
create table public.collection_item_coin_part_components (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.collection_item_coin_parts (id) on delete cascade,
  metal_code    text not null references public.metals (code) on delete restrict,
  percentage    numeric check (percentage is null or (percentage > 0 and percentage <= 100)),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint uq_collection_item_coin_part_components_part_metal unique (part_id, metal_code)
);

comment on table public.collection_item_coin_part_components is
  'Fundação de composição — metal(is) que compõe UMA collection_item_coin_parts. percentage = NULL significa proporção não informada/desconhecida (nunca implica 100%, mesmo quando é o único componente da parte) — se a aplicação sabe que é 100%, grava 100 explicitamente. Soma de percentuais = 100% (quando informados) é responsabilidade da RPC de escrita, não deste schema — nunca soma entre partes diferentes.';

comment on column public.collection_item_coin_part_components.percentage is
  'NULL = proporção não informada/desconhecida. NUNCA interpretado como 100% implícito, mesmo sendo o único componente da parte. Percentuais só têm significado relativo aos outros componentes da MESMA part_id, nunca entre partes diferentes (ex.: núcleo e anel nunca somam juntos).';

create index idx_collection_item_coin_part_components_part on public.collection_item_coin_part_components (part_id);
create index idx_collection_item_coin_part_components_metal on public.collection_item_coin_part_components (metal_code);

alter table public.collection_item_coin_part_components enable row level security;

create policy "collection_item_coin_part_components_select_own"
  on public.collection_item_coin_part_components
  for select
  using (
    exists (
      select 1
      from public.collection_item_coin_parts p
      join public.collection_items ci on ci.id = p.collection_item_id
      where p.id = part_id and ci.user_id = (select auth.uid())
    )
  );

create policy "collection_item_coin_part_components_insert_own"
  on public.collection_item_coin_part_components
  for insert
  with check (
    exists (
      select 1
      from public.collection_item_coin_parts p
      join public.collection_items ci on ci.id = p.collection_item_id
      where p.id = part_id and ci.user_id = (select auth.uid())
    )
  );

create policy "collection_item_coin_part_components_update_own"
  on public.collection_item_coin_part_components
  for update
  using (
    exists (
      select 1
      from public.collection_item_coin_parts p
      join public.collection_items ci on ci.id = p.collection_item_id
      where p.id = part_id and ci.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.collection_item_coin_parts p
      join public.collection_items ci on ci.id = p.collection_item_id
      where p.id = part_id and ci.user_id = (select auth.uid())
    )
  );

create policy "collection_item_coin_part_components_delete_own"
  on public.collection_item_coin_part_components
  for delete
  using (
    exists (
      select 1
      from public.collection_item_coin_parts p
      join public.collection_items ci on ci.id = p.collection_item_id
      where p.id = part_id and ci.user_id = (select auth.uid())
    )
  );
