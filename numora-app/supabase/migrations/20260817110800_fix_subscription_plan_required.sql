-- ============================================================================
-- Etapa 15.7-R1 (correção pré-commit) — subscriptions.plan_id passa a ser
-- obrigatório.
--
-- Motivo: `subscriptions.plan_id` nascia nullable (Etapa 15.7), permitindo
-- teoricamente status='active' com plan_id=NULL — nesse cenário
-- get_effective_plan() entraria na Prioridade 2 (subscription) mas não
-- conseguiria resolver o plano, retornando vazio. Esse estado nunca deve
-- existir: toda subscription real do Stripe está sempre associada a um
-- Price/Product, logo sempre há um plano correspondente.
--
-- `plans.active = false` continua sendo um valor válido para
-- subscriptions.plan_id — "inativo" significa apenas "não vendável para
-- NOVAS assinaturas" (Etapa 15.3), nunca "assinaturas existentes deste
-- plano tornam-se inválidas". Por isso este ALTER TABLE não adiciona
-- nenhum CHECK contra plans.active — só remove a possibilidade de
-- plan_id nulo. A FK para plans(id) (on delete restrict) já existente
-- permanece inalterada.
--
-- Tabela confirmada vazia em produção antes desta alteração (nenhuma
-- subscription real existe ainda — Stripe não integrado) — ALTER TABLE
-- ... SET NOT NULL não precisou de nenhum backfill/UPDATE.
-- ============================================================================

alter table public.subscriptions
  alter column plan_id set not null;
