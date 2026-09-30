-- ============================================================================
-- Etapa "B2 — Signup + Legal" — registro APPEND-ONLY de consentimentos
-- legais (Termos, Privacidade, Cookies, maioridade 18+, opt-in de marketing),
-- com a VERSÃO do documento aceita e a origem do aceite.
--
-- STATUS: candidata a promoção futura para Production — NÃO aplicada em
-- Production por esta etapa (só repositório/DEV).
--
-- ESCRITA: nenhum papel de API (`anon`/`authenticated`) tem INSERT/UPDATE/
-- DELETE. As linhas nascem só pelo trigger `handle_new_user()` (SECURITY
-- DEFINER, ver migration seguinte), na MESMA transação da criação do
-- usuário, a partir da metadata que a rota de cadastro validou no servidor
-- (app/api/auth/signup). Não existe RPC de escrita para `authenticated`
-- nesta etapa (nenhum caso de uso de re-aceite existe ainda).
--
-- APPEND-ONLY:
--   - sem GRANT de UPDATE/DELETE para API roles + trigger que rejeita
--     QUALQUER UPDATE (inclusive de service_role/owner);
--   - DELETE só ocorre pelo `ON DELETE CASCADE` de auth.users (exclusão de
--     conta, mesmo padrão de plan_interest). Retenção do comprovante de
--     aceite após a exclusão da conta é uma decisão jurídica PENDENTE.
--
-- LEITURA (RLS): o usuário lê só as próprias linhas; administrador
-- autorizado (`is_platform_admin()`, padrão existente) lê todas — nunca
-- escreve. `anon` não tem nenhum privilégio.
--
-- `accepted_at` é sempre do servidor (default now()); nenhum caminho aceita
-- timestamp do cliente. Sem `created_at` (redundante com `accepted_at`).
-- ============================================================================

create table public.legal_consents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  document_type     text not null
                      check (document_type in ('terms', 'privacy', 'cookies', 'age_18', 'marketing_email')),
  document_version  text not null
                      check (document_version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$'),
  accepted_at       timestamptz not null default now(),
  source            text not null
                      check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint uq_legal_consents_user_document_version unique (user_id, document_type, document_version)
);

comment on table public.legal_consents is
  'Etapa B2 — comprovante APPEND-ONLY de aceite de documentos legais/declarações (tipo + versão + origem + instante do servidor). Escrita só via trigger handle_new_user; sem UPDATE/DELETE por API roles.';

comment on column public.legal_consents.document_type is
  'terms | privacy | cookies | age_18 | marketing_email — lista controlada (mesma de lib/legal/versions.ts).';

comment on column public.legal_consents.document_version is
  'Versão do documento/declaração aceita (lib/legal/versions.ts) — nunca vazia.';

comment on column public.legal_consents.source is
  'Origem do aceite (ex.: signup). Identificador em minúsculas.';

alter table public.legal_consents enable row level security;

create policy "legal_consents_select_own"
  on public.legal_consents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "legal_consents_select_admin"
  on public.legal_consents
  for select
  to authenticated
  using (public.is_platform_admin());

-- Nenhuma policy de INSERT/UPDATE/DELETE para nenhum papel de API. GRANTs:
-- `anon` sem nada; `authenticated` só SELECT (RLS decide QUAIS linhas).
revoke all on table public.legal_consents from anon;
revoke insert, update, delete, truncate, references, trigger on table public.legal_consents from authenticated;

-- Imutabilidade: rejeita UPDATE para qualquer papel (defesa em profundidade
-- além da ausência de GRANT/policy).
create or replace function public.legal_consents_reject_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'legal_consents é append-only: UPDATE não é permitido.' using errcode = '42501';
end;
$$;

revoke execute on function public.legal_consents_reject_update() from public, anon, authenticated;

create trigger legal_consents_no_update
  before update on public.legal_consents
  for each row execute function public.legal_consents_reject_update();
