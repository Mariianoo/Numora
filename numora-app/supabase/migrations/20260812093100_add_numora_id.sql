-- ============================================================================
-- numora_id: identificador legível e imutável do colecionador (Passport),
-- independente do `id` uuid interno (formato "NUM-0000001").
--
-- Gerado via SEQUENCE, não via MAX(numora_id) + 1: `nextval()` é atômico
-- por construção do Postgres — duas transações concorrentes nunca recebem
-- o mesmo valor, sem precisar de lock explícito nem de retry na aplicação.
-- MAX()+1 teria corrida clássica de leitura-e-escrita sob inserts
-- simultâneos (dois profiles lendo o mesmo MAX antes de qualquer um
-- commitar). Gaps na sequência (ex.: se um insert falhar depois de já ter
-- consumido um nextval) são aceitáveis — o requisito é unicidade, não
-- numeração contígua.
-- ============================================================================

alter table public.profiles
  add column numora_id text;

-- `security definer` + `search_path` fixo: mesmo padrão já usado em
-- `handle_new_user` (20260808170019_create_profiles.sql) — evita sequestro
-- de search_path e garante que a trigger sempre consegue avançar a
-- sequence, independente do papel que disparou o insert.
create sequence public.numora_id_seq
  as bigint
  start with 1
  increment by 1
  no cycle;

create or replace function public.assign_numora_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numora_id is null then
    new.numora_id := 'NUM-' || lpad(nextval('public.numora_id_seq')::text, 7, '0');
  end if;
  return new;
end;
$$;

revoke execute on function public.assign_numora_id() from public, anon, authenticated;

create trigger set_numora_id
  before insert on public.profiles
  for each row
  execute function public.assign_numora_id();

-- Backfill defensivo: hoje `profiles` está vazia, mas a migration precisa
-- ser correta independente disso (idempotente — só afeta linhas sem
-- numora_id).
update public.profiles
set numora_id = 'NUM-' || lpad(nextval('public.numora_id_seq')::text, 7, '0')
where numora_id is null;

alter table public.profiles
  alter column numora_id set not null;

alter table public.profiles
  add constraint uq_profiles_numora_id unique (numora_id);

-- Imutabilidade: uma vez atribuído, numora_id nunca muda — nem por um
-- update legítimo de outro campo do mesmo profile, nem por um futuro path
-- administrativo. Bloqueio incondicional, não depende de RLS/role.
create or replace function public.prevent_numora_id_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numora_id is distinct from old.numora_id then
    raise exception 'numora_id é imutável e não pode ser alterado (era %, tentativa: %)',
      old.numora_id, new.numora_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_numora_id_change() from public, anon, authenticated;

create trigger protect_numora_id
  before update on public.profiles
  for each row
  execute function public.prevent_numora_id_change();
