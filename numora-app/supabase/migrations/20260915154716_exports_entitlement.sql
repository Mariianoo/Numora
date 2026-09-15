-- ============================================================================
-- Etapa "5.10U — Exportação da Coleção" — popula `plan_entitlements` para o
-- feature_key `exports`, já reservado (e deliberadamente deixado vazio) por
-- `20260817140300_seed_plan_entitlements.sql`: "exports — recurso não
-- existe em NENHUM lugar do código... Não é recurso real ou claramente
-- planejado o suficiente para popular agora." Esta etapa implementa o
-- recurso (exportação CSV client-side da coleção), então a lacuna
-- documentada naquela migration é preenchida agora, pelo mesmo motivo que a
-- justificou: o recurso passa a existir de verdade no código.
--
-- Mesmo padrão EXATO de `20260910170754_dashboard_advanced_entitlement.sql`
-- (o único outro entitlement puramente booleano do projeto): Free
-- enabled=false; Pro/Premium enabled=true; limit_value=NULL (não é um
-- limite quantitativo, é liga/desliga). Nenhuma lógica paralela de
-- entitlement — `get_my_entitlement('exports')` já existe desde a Etapa
-- 15.8-R2, nenhuma função nova.
--
-- Mesma ressalva já documentada para `dashboard_advanced`: este
-- entitlement é SÓ UX. Os dados exportados (collection_items/
-- collection_units/purchases do PRÓPRIO usuário) já são protegidos por RLS
-- de ownership, inalterada por esta migration — esconder o botão no
-- frontend nunca é a barreira de segurança de um dado que já pertence ao
-- próprio usuário.
-- ============================================================================

insert into public.plan_entitlements (plan_id, feature_key, enabled, limit_value)
select p.id, 'exports', (p.slug in ('pro', 'premium')), null
from public.plans p
where p.slug in ('free', 'pro', 'premium')
on conflict (plan_id, feature_key) do nothing;
