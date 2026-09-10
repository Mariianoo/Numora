-- ============================================================================
-- Etapa "5.9C — Dashboard Gate": primeiro entitlement puramente BOOLEANO do
-- Paywall (sem limit_value) — reaproveita 100% a arquitetura já existente
-- (plan_entitlements/get_entitlement/get_my_entitlement), mesmo padrão já
-- usado por `labels` (Etapa "F4 — Numora Labels").
--
-- feature_key='dashboard_advanced': Free enabled=false; Pro/Premium
-- enabled=true. limit_value=NULL para todos (não é um limite quantitativo,
-- é liga/desliga).
--
-- IMPORTANTE (mesma distinção já documentada para `labels` em
-- features/labels/repositories/labels.repository.ts): este entitlement é
-- SÓ UX — decide se o Dashboard busca/renderiza a seção avançada. Os dados
-- por trás (collection_items/collection_units/purchases do PRÓPRIO
-- usuário) já são protegidos por RLS de ownership, inalterada por esta
-- migration. Esconder um componente no frontend NUNCA é a barreira de
-- segurança de um dado que já pertence ao próprio usuário — é só uma
-- decisão de produto sobre o que é exibido para cada plano.
-- ============================================================================

insert into public.plan_entitlements (plan_id, feature_key, enabled, limit_value)
select p.id, 'dashboard_advanced', (p.slug in ('pro', 'premium')), null
from public.plans p
where p.slug in ('free', 'pro', 'premium')
on conflict (plan_id, feature_key) do nothing;
