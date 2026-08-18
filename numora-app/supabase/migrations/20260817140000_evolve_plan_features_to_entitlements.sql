-- ============================================================================
-- Etapa 15.8 (Modelo Comercial + Entitlements) — evolução de
-- `plan_features` (Etapa 15.3) para `plan_entitlements`.
--
-- ACHADO DA AUDITORIA: `plan_features` (plan_id, feature, enabled,
-- "limit") já tinha exatamente a finalidade pedida nesta etapa para
-- `plan_entitlements` — tabela vazia (0 linhas) e sem NENHUM consumidor
-- real no código (confirmado: só citada como texto descritivo em
-- `app/admin/subscriptions/page.tsx`, nunca consultada). Criar uma tabela
-- nova duplicaria essa estrutura. Em vez disso, esta migration EVOLUI a
-- tabela existente: renomeia para `plan_entitlements`, renomeia colunas
-- para os nomes desta etapa (`feature`→`feature_key`, `"limit"`→
-- `limit_value`), adiciona `id`/`created_at`/`updated_at` (mesmo padrão
-- de toda tabela deste projeto). Seguro porque a tabela está vazia — não
-- há dado a migrar/perder.
--
-- `limit_value = NULL` significa "ilimitado" — documentado aqui
-- explicitamente (Etapa 15.8, não assumido silenciosamente): a ausência
-- de um teto numérico é tratada por `get_entitlement()`/
-- `check_entitlement_limit()` (próxima migration) como "sem limite
-- aplicável", nunca como "zero"/"negado".
-- ============================================================================

alter table public.plan_features rename to plan_entitlements;

alter table public.plan_entitlements drop constraint plan_features_pkey;

alter table public.plan_entitlements rename column feature to feature_key;
alter table public.plan_entitlements rename column "limit" to limit_value;

alter table public.plan_entitlements add column id uuid not null default gen_random_uuid();
alter table public.plan_entitlements add constraint plan_entitlements_pkey primary key (id);
alter table public.plan_entitlements add constraint uq_plan_entitlements_plan_feature unique (plan_id, feature_key);
alter table public.plan_entitlements add constraint chk_plan_entitlements_limit_value check (limit_value is null or limit_value >= 0);

alter table public.plan_entitlements add column created_at timestamptz not null default now();
alter table public.plan_entitlements add column updated_at timestamptz not null default now();

comment on table public.plan_entitlements is
  'Etapa 15.8 — catálogo de recursos habilitados/limites por plano (evoluída de plan_features, Etapa 15.3, que nunca teve consumidor real). limit_value = NULL significa ILIMITADO (documentado, nunca assumido silenciosamente pelo código consumidor). Nunca consultada diretamente pela aplicação fora de features/collection etc — o caminho é sempre via get_entitlement()/check_entitlement_limit().';

comment on column public.plan_entitlements.limit_value is
  'NULL = ilimitado (documentado explicitamente, Etapa 15.8). Número = teto quantitativo daquele feature_key para o plano.';

create trigger set_plan_entitlements_updated_at
  before update on public.plan_entitlements
  for each row
  execute function public.set_updated_at();

-- Policies existentes (plan_features_select_authenticated,
-- plan_features_admin_write) sobrevivem ao RENAME TABLE automaticamente
-- no Postgres, mas seus NOMES continuam com o prefixo antigo — renomeadas
-- aqui só por clareza (mesmo comportamento, sem gap de segurança).
alter policy "plan_features_select_authenticated" on public.plan_entitlements
  rename to "plan_entitlements_select_authenticated";

-- A policy de escrita antiga (is_platform_admin()) é substituída por
-- restrict_commercial_config_to_owner.sql (próxima migration) — aqui só
-- renomeada, ainda com o comportamento antigo, para evitar uma janela sem
-- nenhuma policy de escrita entre as duas migrations.
alter policy "plan_features_admin_write" on public.plan_entitlements
  rename to "plan_entitlements_admin_write_deprecated";
