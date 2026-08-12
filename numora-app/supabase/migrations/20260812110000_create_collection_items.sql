-- ============================================================================
-- Fase 1, Etapa 4 — `collection_items`: item central da coleção pessoal.
--
-- Junta "o que é a moeda" (país, ano, denominação, metal, peso, pureza,
-- grau) e "o que eu tenho dela" (quantidade, custo) numa única linha —
-- decisão já revisada e aprovada: não separar catálogo de posse nesta
-- fase (YAGNI). `purchase_id` é a relação com a Etapa 3: purchases
-- 1 ─── N collection_items (um lote é simplesmente uma purchase com mais
-- de um item vinculado — sem tabela/conceito próprio de "lote").
--
-- Omitidos de propósito nesta etapa (fora de escopo, ver regras 4/5):
--   - `status` (owned/partially_sold/sold): é campo derivado de `sales`,
--     que ainda não existe — nasce junto com a tabela `sales` e o
--     trigger que o mantém.
--   - `deleted_at` (soft delete): esta etapa testa e usa DELETE real via
--     policy; não faz sentido ter dois mecanismos de exclusão
--     coexistindo sem uso real de um deles.
--
-- Nota de implementação vs. o desenho textual revisado anteriormente:
-- lá o campo estava descrito como "grade_code" — mas `grades` (Etapa 1)
-- tem PK substituta `id` (uuid), com `(scale, code)` como unique
-- composto, não `code` sozinho. A FK correta para uma única coluna é
-- `grade_id uuid references grades(id)`, não `grade_code`. `grades` não
-- foi alterada; só está sendo referenciada pela sua PK real.
-- ============================================================================

create table public.collection_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  purchase_id           uuid references public.purchases (id) on delete set null,
  country_code          char(2) references public.countries (code) on delete restrict,
  country_name          text,
  year                  integer,
  denomination          text,
  mint                  text,
  metal_code            text references public.metals (code) on delete restrict,
  secondary_metal_code  text references public.metals (code) on delete restrict,
  gross_weight_g        numeric check (gross_weight_g is null or gross_weight_g > 0),
  purity                numeric check (purity is null or (purity > 0 and purity <= 1)),
  grade_id              uuid references public.grades (id) on delete restrict,
  face_value            numeric check (face_value is null or face_value >= 0),
  quantity              integer not null default 1 check (quantity > 0),
  unit_cost_override    numeric check (unit_cost_override is null or unit_cost_override >= 0),
  description           text,
  location              text,
  tags                  text[],
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.collection_items is
  'Item da coleção pessoal — junta catálogo (país/ano/metal/peso/grau) e posse (quantidade/custo) numa única linha. purchase_id nullable liga à Etapa 3 (purchases); vários itens podem compartilhar a mesma purchase (lote). status/deleted_at ficam para etapas futuras (sales / soft delete), de propósito.';

comment on column public.collection_items.purchase_id is
  'FK opcional para purchases.id. Nula = item sem compra registrada (presente/herança). Vários collection_items podem apontar para a mesma purchase — é assim que um lote (várias moedas diferentes compradas juntas por um preço total) é representado, sem tabela própria de "lote". ON DELETE SET NULL: apagar o registro de compra não destrói o item da coleção, só desvincula.';

comment on column public.collection_items.quantity is
  'Default 1 = um exemplar físico (caminho normal). quantity > 1 é opt-in explícito para lote fungível não-diferenciado (ex.: bulhão) — ver decisão arquitetural revisada desta fase.';

comment on column public.collection_items.unit_cost_override is
  'Refina o custo deste item quando purchase_id aponta para uma compra compartilhada por vários itens (lote) e o custo por peça não é uma divisão igualitária do total. Nulo = usa a divisão igualitária padrão (aplicada em código, não no banco).';

alter table public.collection_items enable row level security;

create policy "collection_items_select_own"
  on public.collection_items
  for select
  using ((select auth.uid()) = user_id);

-- INSERT/UPDATE verificam, além da posse da própria linha, que
-- purchase_id (quando informado) pertence ao mesmo usuário — sem isso,
-- um usuário poderia associar seu item a uma purchase de outra pessoa:
-- a RLS de collection_items sozinha não enxerga a ownership de purchases,
-- por isso o subselect explícito contra purchases.user_id.
create policy "collection_items_insert_own"
  on public.collection_items
  for insert
  with check (
    (select auth.uid()) = user_id
    and (
      purchase_id is null
      or exists (
        select 1 from public.purchases p
        where p.id = purchase_id and p.user_id = (select auth.uid())
      )
    )
  );

create policy "collection_items_update_own"
  on public.collection_items
  for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      purchase_id is null
      or exists (
        select 1 from public.purchases p
        where p.id = purchase_id and p.user_id = (select auth.uid())
      )
    )
  );

create policy "collection_items_delete_own"
  on public.collection_items
  for delete
  using ((select auth.uid()) = user_id);

-- Listagem padrão ("mais recentes primeiro") e RLS.
create index idx_collection_items_user_created on public.collection_items (user_id, created_at desc);
-- Suporta o agrupamento "distribuição por país" já previsto no dashboard
-- (Fase 3) — não é especulativo, é um padrão de acesso já desenhado.
create index idx_collection_items_user_country on public.collection_items (user_id, country_code);
-- Cobertura da FK + lookup reverso "quais itens pertencem a esta
-- purchase" (necessário para dividir custo de lote).
create index idx_collection_items_purchase on public.collection_items (purchase_id);

-- Reaproveita a função já criada na Etapa 2 — nenhuma função nova.
create trigger set_collection_items_updated_at
  before update on public.collection_items
  for each row
  execute function public.set_updated_at();
