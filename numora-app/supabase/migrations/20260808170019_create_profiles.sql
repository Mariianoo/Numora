-- profiles: dados de perfil vinculados 1:1 a auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id);

-- Cria o profile automaticamente quando um novo usuário nasce em
-- auth.users (ex.: primeiro login via Google). `security definer` é
-- necessário pois o trigger roda fora do contexto de sessão do usuário,
-- então precisa de privilégio para inserir mesmo com RLS habilitado.
-- `on conflict do nothing` é a "verificação de existência": idempotente
-- caso o trigger seja dispar mais de uma vez para o mesmo usuário.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
