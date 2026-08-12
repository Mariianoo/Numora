-- ============================================================================
-- Fase 1, Etapa 2 — extensão de `profiles` para identidade do colecionador,
-- dados de Passport (schema apenas — sem UI) e plano/papel de autorização.
-- `numora_id` é tratado em migration separada (precisa de sequence/trigger
-- antes de poder virar NOT NULL/UNIQUE).
-- ============================================================================

alter table public.profiles
  add column username         text,
  add column avatar_url       text,
  add column country_code     char(2) references public.countries (code) on delete restrict,
  add column plan_tier        text not null default 'free',
  add column role             text not null default 'user',
  add column passport_public  boolean not null default false,
  add column collector_since  date not null default current_date,
  add column updated_at       timestamptz not null default now();

alter table public.profiles
  add constraint chk_profiles_plan_tier check (plan_tier in ('free', 'premium')),
  add constraint chk_profiles_role check (role in ('user', 'seller', 'admin')),
  add constraint uq_profiles_username unique (username);

comment on column public.profiles.plan_tier is
  'Fonte rápida de verdade para a camada can()/capabilities da aplicação. Sincronizada por `subscriptions` quando a Fase 5 existir.';
comment on column public.profiles.role is
  'Papel de autorização (user/seller/admin). Nunca alterável pelo próprio usuário — protegido por GRANT column-level, ver migration de RLS desta mesma etapa.';
comment on column public.profiles.collector_since is
  'Data de emissão exibida no Passport. Default na criação; sem trigger de imutabilidade — é um dado editável em tese, mas fora de escopo desta etapa.';

-- Mantém `updated_at` corrente em qualquer alteração da linha. Função
-- genérica e reutilizável — não específica de `profiles`.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();
