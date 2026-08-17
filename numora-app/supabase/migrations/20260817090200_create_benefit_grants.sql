-- ============================================================================
-- Etapa 15.3 (Admin Control Center) — cortesias/benefícios administrativos.
--
-- Suporta casos como "usuário parceiro recebe Pro grátis por 90 dias" sem
-- alterar `profiles.plan_tier` diretamente/irreversivelmente (exigência
-- explícita desta etapa): o benefício é um registro histórico com
-- vigência (`starts_at`/`expires_at`) e revogação (`revoked_at`), nunca uma
-- sobrescrita do plano. A leitura de "o usuário está em cortesia agora?"
-- é sempre derivada (vigência + não revogado) — nunca um campo booleano
-- solto que possa dessincronizar.
--
-- A lógica comercial completa (aplicar automaticamente o plano efetivo,
-- expirar e reverter) fica para uma etapa futura — aqui só a fundação de
-- dados, como pedido explicitamente.
-- ============================================================================

create table public.benefit_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in ('trial', 'courtesy', 'partnership', 'beta', 'admin')),
  plan       text not null references public.plans (slug) on delete restrict,
  reason     text,
  starts_at  timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint chk_benefit_grants_expires_after_starts check (expires_at is null or expires_at > starts_at)
);

comment on table public.benefit_grants is
  'Etapa 15.3 — concessões administrativas de plano (cortesia/parceria/trial/beta), com vigência e revogação. Nunca sobrescreve profiles.plan_tier diretamente.';

create index idx_benefit_grants_user on public.benefit_grants (user_id);

-- `created_by` nunca é confiável vindo do client — mesmo padrão de
-- ownership resolvido no servidor já usado em purchases/collection_units
-- (nunca aceitar de fora, sempre forçar aqui).
create or replace function public.enforce_benefit_grant_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

revoke execute on function public.enforce_benefit_grant_created_by() from public, anon, authenticated;

create trigger set_benefit_grant_created_by
  before insert on public.benefit_grants
  for each row
  execute function public.enforce_benefit_grant_created_by();

alter table public.benefit_grants enable row level security;

-- Somente administradores gerenciam cortesias nesta etapa — a etapa não
-- pede uma tela de usuário exibindo o próprio benefício ainda; abrir
-- leitura própria fica para quando essa UI existir, para não expandir
-- superfície de RLS sem consumidor real.
create policy "benefit_grants_admin_all"
  on public.benefit_grants
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
