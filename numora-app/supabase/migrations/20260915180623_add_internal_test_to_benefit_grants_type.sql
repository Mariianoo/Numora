-- ============================================================================
-- Etapa "5.10W.2 — Conta de Análise: plano simulado" — amplia
-- `benefit_grants.type` para aceitar `'internal_test'`, distinguindo
-- claramente um grant simulado da Conta de Análise de uma cortesia real
-- ('trial'/'courtesy'/'partnership'/'beta'/'admin').
--
-- CONFIRMAÇÃO EXPLÍCITA (pedida antes de qualquer mudança estrutural):
-- `effective_plans()` (`20260818131512_create_effective_plans_source.sql`,
-- CTE `courtesy_candidates`) NUNCA filtra por `benefit_grants.type` — ela
-- já trata QUALQUER linha não revogada/vigente de `benefit_grants` como
-- prioridade 1 (acima de subscription/free), independente do `type`. Logo,
-- `'internal_test'` já herda automaticamente a MESMA prioridade máxima
-- assim que existir uma linha com esse `type` — nenhuma alteração em
-- `effective_plans()`/`get_effective_plan()`/`get_my_entitlement()` é
-- necessária. Esta migration é PURAMENTE aditiva ao CHECK constraint.
--
-- Nenhum comportamento de cortesia real (`type` já existente) muda —
-- os 5 valores originais continuam aceitos exatamente como antes.
-- ============================================================================

alter table public.benefit_grants
  drop constraint benefit_grants_type_check;

alter table public.benefit_grants
  add constraint benefit_grants_type_check
  check (type in ('trial', 'courtesy', 'partnership', 'beta', 'admin', 'internal_test'));
