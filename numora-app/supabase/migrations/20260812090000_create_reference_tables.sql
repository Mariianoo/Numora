-- ============================================================================
-- Tabelas de referência: countries, metals, grades.
-- Dados estáveis e compartilhados entre todos os usuários — nunca contêm
-- dado de um usuário específico. RLS habilitada com uma única policy de
-- `select` liberada a todos (dado público, não sensível); nenhuma policy de
-- insert/update/delete é criada de propósito: com RLS habilitada e sem
-- nenhuma policy de escrita, o Postgres nega toda escrita por padrão
-- (fail-closed) — não é necessário escrever uma policy de negação
-- explícita para isso.
-- ============================================================================

create table public.countries (
  code       char(2) primary key,
  name       text not null,
  flag_emoji text,
  created_at timestamptz not null default now()
);

comment on table public.countries is
  'Referência de países (ISO 3166-1 alpha-2). Somente leitura para usuários; expansão via migration/seed, nunca via UI.';

alter table public.countries enable row level security;

create policy "countries_select_all"
  on public.countries
  for select
  using (true);

-- ----------------------------------------------------------------------------

create table public.metals (
  code        text primary key,
  name        text not null,
  is_precious boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.metals is
  'Referência de metais (elementos e ligas comuns em numismática). Somente leitura para usuários.';

alter table public.metals enable row level security;

create policy "metals_select_all"
  on public.metals
  for select
  using (true);

-- ----------------------------------------------------------------------------

-- `grades` suporta múltiplas escalas de conservação simultaneamente (ex.:
-- escala brasileira adjetiva e escala Sheldon internacional) — por isso o
-- código sozinho não é único globalmente, só dentro da escala
-- (constraint uq_grades_scale_code), e a PK é um id substituto.
create table public.grades (
  id         uuid primary key default gen_random_uuid(),
  scale      text not null,
  code       text not null,
  label      text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint uq_grades_scale_code unique (scale, code)
);

create index idx_grades_scale_sort on public.grades (scale, sort_order);

comment on table public.grades is
  'Referência de graus de conservação, agrupados por escala (`scale`). Somente leitura para usuários.';

alter table public.grades enable row level security;

create policy "grades_select_all"
  on public.grades
  for select
  using (true);
