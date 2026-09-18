-- ============================================================================
-- Etapa "5.10W.1 — Conta de Análise: identidade" — tabela-marcador que
-- identifica EXCLUSIVAMENTE quais `profiles` são Contas de Análise
-- internas (usuários reais do Supabase Auth, com user_id próprio, nunca
-- criados por signup público — auditoria 5.10W).
--
-- NUNCA um mecanismo de e-mail hardcoded (`if (user.email === ...)`) —
-- exatamente o padrão já estabelecido por `is_platform_admin()`/
-- `is_platform_owner()` (Etapa 15.3/15.7): autorização/identificação
-- sempre por uma linha em uma tabela real, nunca por comparação de string
-- solta no código da aplicação.
--
-- Mesma filosofia minimalista de `feedback_admin_notes` (Etapa "F3"): uma
-- tabela pequena, de propósito único, em vez de uma coluna nova em
-- `profiles` — mantém `profiles`/sua RLS/seus grants inteiramente
-- intocados, e torna "quem é Conta de Análise?" uma pergunta trivialmente
-- auditável (`select * from internal_test_accounts`), restrita a quem já
-- tem acesso administrativo de leitura.
--
-- `user_id` é a PK (nunca mais de uma linha por usuário — uma conta é ou
-- não é de análise, nunca "um pouco"). `on delete cascade`: se o usuário
-- for excluído (via `delete_own_account_data()`, mesmo caminho de
-- qualquer conta), o marcador desaparece junto, nunca um resíduo órfão.
-- `created_by references profiles (id) on delete restrict` — mesmo padrão
-- de `benefit_grants.created_by`: nunca perde o registro de QUEM criou o
-- marcador só porque aquele owner específico foi removido depois.
-- ============================================================================

create table public.internal_test_accounts (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

comment on table public.internal_test_accounts is
  'Etapa "5.10W.1 — Conta de Análise" — marca exclusivamente quais profiles são Contas de Análise internas (nunca faturáveis, nunca contam como usuário real em métricas comerciais). Único mecanismo de identificação — nunca e-mail hardcoded no código da aplicação.';

alter table public.internal_test_accounts enable row level security;

-- ----------------------------------------------------------------------------
-- RLS — mesmo padrão de `benefit_grants` (Etapa 15.8-R3): leitura
-- administrativa (owner OU admin), escrita (insert/update/delete)
-- exclusiva de OWNER. Usuário comum não tem NENHUMA policy — nem para a
-- própria linha, caso um dia ele mesmo fosse (hipoteticamente) uma conta
-- de análise, o que nunca deveria acontecer via ação própria de qualquer
-- forma.
-- ----------------------------------------------------------------------------

create policy "internal_test_accounts_select_admin"
  on public.internal_test_accounts
  for select
  using (public.is_platform_admin());

create policy "internal_test_accounts_owner_insert"
  on public.internal_test_accounts
  for insert
  with check (public.is_platform_owner());

create policy "internal_test_accounts_owner_update"
  on public.internal_test_accounts
  for update
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create policy "internal_test_accounts_owner_delete"
  on public.internal_test_accounts
  for delete
  using (public.is_platform_owner());

comment on policy "internal_test_accounts_select_admin" on public.internal_test_accounts is
  'Leitura administrativa (owner ou admin) — mesmo nível de acesso já usado para ver benefit_grants/profiles de qualquer usuário.';
comment on policy "internal_test_accounts_owner_insert" on public.internal_test_accounts is
  'Só OWNER pode marcar uma conta como Conta de Análise — mesma restrição já aplicada a benefit_grants (decisão comercial/estrutural, nunca um admin comum).';

-- Endurecimento de GRANT (mesmo padrão já aplicado a toda tabela nova
-- desde a Etapa 5.10U): `anon` fica com ZERO privilégios. `authenticated`
-- NÃO tem `insert`/`update`/`delete` revogados aqui — ao contrário de
-- `analytics_outbox` (zero policies, zero acesso para qualquer papel),
-- esta tabela TEM policies que dependem do papel `authenticated` reter o
-- GRANT de escrita (só a predicate de RLS, `is_platform_owner()`,
-- distingue quem realmente pode escrever) — revogar o GRANT bloquearia
-- também o próprio owner. `truncate` é revogado por não ter nenhum caso
-- de uso legítimo (mesmo padrão de toda tabela já endurecida no projeto).
revoke all on table public.internal_test_accounts from anon;
revoke truncate on table public.internal_test_accounts from authenticated;
