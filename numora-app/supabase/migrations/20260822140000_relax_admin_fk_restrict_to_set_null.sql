-- ============================================================================
-- Etapa 15.10.17A (Fundação de exclusão de conta) — corrige as únicas 2 FKs
-- de todo o schema que apontam para `profiles(id)` com `ON DELETE RESTRICT`
-- (confirmado via auditoria read-only do catálogo real: `pg_constraint`,
-- nenhuma outra tabela usa RESTRICT contra `profiles`). Ambas bloqueariam
-- indefinidamente a exclusão de qualquer conta que já tenha agido como
-- admin/owner (`admin_audit_logs.actor_user_id`) ou concedido uma cortesia
-- (`benefit_grants.created_by`).
--
-- Trocamos para `ON DELETE SET NULL`: preserva o registro histórico da ação
-- administrativa (nunca apagado), só remove o vínculo com uma pessoa que não
-- existe mais — coerente com minimização de dados (LGPD) sem destruir
-- trilha de auditoria. `admin_audit_logs.target_user_id` já usa `SET NULL`
-- desde a criação da tabela (nada a mudar ali).
--
-- Ambas as colunas são hoje `NOT NULL` (confirmado via
-- `pg_attribute.attnotnull`) — um `SET NULL` sozinho falharia em tempo de
-- cascade sem primeiro remover essa restrição. Por isso este arquivo
-- também relaxa `NOT NULL` nas 2 colunas, na mesma migration.
--
-- Confirmado, na auditoria antes desta migration: `admin_audit_logs` e
-- `benefit_grants` têm 0 linhas em produção hoje — nenhum dado real é
-- afetado por esta mudança de constraint.
-- ============================================================================

alter table public.admin_audit_logs
  alter column actor_user_id drop not null;

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_actor_user_id_fkey;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_actor_user_id_fkey
  foreign key (actor_user_id) references public.profiles (id) on delete set null;

comment on column public.admin_audit_logs.actor_user_id is
  'Quem executou a ação administrativa. NULL = o ator original excluiu a própria conta depois (Etapa 15.10.17A) — o registro da ação permanece, só o vínculo pessoal é removido.';

alter table public.benefit_grants
  alter column created_by drop not null;

alter table public.benefit_grants
  drop constraint benefit_grants_created_by_fkey;

alter table public.benefit_grants
  add constraint benefit_grants_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

comment on column public.benefit_grants.created_by is
  'Quem concedeu a cortesia. NULL = quem concedeu excluiu a própria conta depois (Etapa 15.10.17A) — a cortesia concedida ao beneficiário (user_id) permanece intacta.';
