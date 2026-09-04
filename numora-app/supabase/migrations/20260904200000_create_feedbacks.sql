-- ============================================================================
-- Etapa "F3 — Numora Feedback" — Central de Feedback do Closed Beta.
--
-- `user_id references public.profiles (id)` — não `auth.users(id)` como o
-- enunciado original sugeria: seguindo o padrão de TODA outra tabela de
-- dado de usuário do projeto (`collection_items`, `purchases`,
-- `user_acquisition`...). Vantagem prática real, não só estilística:
-- `delete_own_account_data()` (`DELETE FROM public.profiles ...`) já cobre
-- `feedbacks`/`feedback_admin_notes` automaticamente via `on delete
-- cascade` em cadeia, sem precisar tocar naquela função/migration.
--
-- Nenhuma linha pode ter `title`/`message` vazio (ou só espaços) nem
-- ultrapassar um tamanho razoável — CHECK no banco, nunca só client-side
-- (mesmo padrão de `chk_profiles_role`, `add_passport_public_username_check`).
--
-- DESENHO EM 2 TABELAS (achado real desta etapa, corrigido antes do
-- commit): `admin_notes` NÃO fica em `feedbacks`. RLS do Postgres é
-- ROW-level, nunca column-level dentro de uma mesma policy — a policy
-- `feedbacks_select_own` (necessária para o autor ver seu próprio
-- feedback) devolveria a LINHA inteira, inclusive qualquer coluna
-- `admin_notes` que existisse nela, porque owner/admin autenticam como o
-- MESMO role Postgres `authenticated` (só `profiles.role` os distingue,
-- em nível de aplicação/RLS, nunca em nível de GRANT column). Colocar a
-- observação interna numa tabela À PARTE, com RLS restrita SÓ a
-- `is_platform_admin()` (nenhuma policy para o autor do feedback, nem
-- para a própria linha), é o jeito real de garantir "visível somente para
-- admin" — não uma convenção de UI que o client poderia contornar
-- chamando a API/Supabase direto (exatamente o cenário que esta etapa
-- pede para nunca confiar).
-- ============================================================================

create table public.feedbacks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  type           text not null check (type in ('praise', 'suggestion', 'problem')),
  title          text not null check (char_length(trim(title)) between 1 and 120),
  message        text not null check (char_length(trim(message)) between 1 and 4000),
  wants_contact  boolean not null default false,
  status         text not null default 'new'
                   check (status in ('new', 'reviewing', 'planned', 'in_progress', 'completed', 'dismissed')),
  priority       text not null default 'medium'
                   check (priority in ('low', 'medium', 'high', 'critical')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.feedbacks is
  'Etapa "F3 — Numora Feedback" — feedback de usuário (elogio/sugestão/problema) no Closed Beta. Observação interna do admin vive em feedback_admin_notes (tabela separada, nunca nesta), de propósito — ver comentário do arquivo desta migration.';

create index idx_feedbacks_user_created on public.feedbacks (user_id, created_at desc);
create index idx_feedbacks_status on public.feedbacks (status);

alter table public.feedbacks enable row level security;

-- Reaproveita a função já criada na Etapa 2 (`set_updated_at`) — nenhuma
-- função nova necessária para manter updated_at corrente.
create trigger set_feedbacks_updated_at
  before update on public.feedbacks
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS de `feedbacks`. Usuário comum: INSERT/SELECT só da própria linha,
-- NENHUM UPDATE (nem da própria linha) — não há pedido de editar feedback
-- após o envio, então a ausência de qualquer policy de UPDATE para
-- authenticated já barra status/priority por padrão do Postgres
-- (deny-by-default), sem precisar de GRANT column-level. Admin
-- (is_platform_admin(), Etapa 15.3 — owner OU admin): lê tudo, atualiza
-- status/priority. Sem policy de DELETE para ninguém (registro
-- permanente, nunca apagado).
-- ----------------------------------------------------------------------------

create policy "feedbacks_insert_own"
  on public.feedbacks
  for insert
  with check ((select auth.uid()) = user_id);

create policy "feedbacks_select_own"
  on public.feedbacks
  for select
  using ((select auth.uid()) = user_id);

create policy "feedbacks_select_admin"
  on public.feedbacks
  for select
  using (public.is_platform_admin());

create policy "feedbacks_update_admin"
  on public.feedbacks
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

comment on policy "feedbacks_select_own" on public.feedbacks is
  'Usuário lê só os próprios feedbacks — aditiva a feedbacks_select_admin, nunca expõe feedback de outro usuário.';
comment on policy "feedbacks_update_admin" on public.feedbacks is
  'Único caminho de UPDATE em feedbacks (status/priority) — usuário comum não tem nenhuma policy de update, nem para a própria linha.';

-- ----------------------------------------------------------------------------
-- `feedback_admin_notes` — observação interna, 1 linha por feedback
-- (`feedback_id` é a própria PK, não um `id` próprio: nunca existe mais de
-- uma nota por feedback, um upsert por `feedback_id` é sempre o caminho
-- certo). RLS restrita a `is_platform_admin()` em TODAS as operações —
-- nenhuma policy para o autor do feedback, nem mesmo de SELECT. Esta é a
-- garantia real de "visível somente para admin", ao nível do banco.
-- ----------------------------------------------------------------------------

create table public.feedback_admin_notes (
  feedback_id  uuid primary key references public.feedbacks (id) on delete cascade,
  notes        text,
  updated_at   timestamptz not null default now()
);

comment on table public.feedback_admin_notes is
  'Etapa "F3 — Numora Feedback" — observação interna do time Numora sobre um feedback. RLS só permite is_platform_admin() (select/insert/update) — o autor do feedback NUNCA tem policy nenhuma sobre esta tabela, nem para o próprio feedback.';

alter table public.feedback_admin_notes enable row level security;

create trigger set_feedback_admin_notes_updated_at
  before update on public.feedback_admin_notes
  for each row
  execute function public.set_updated_at();

create policy "feedback_admin_notes_all_admin"
  on public.feedback_admin_notes
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

comment on policy "feedback_admin_notes_all_admin" on public.feedback_admin_notes is
  'Única policy da tabela — cobre select/insert/update/delete, só para is_platform_admin(). Nenhum usuário comum tem qualquer acesso, nem à nota do próprio feedback.';
